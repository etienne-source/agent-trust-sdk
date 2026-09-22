import { normalizeDomain } from "@agentic-trust/sdk";

/** Hosted Trustflow Systems verification API. The protocol is AgenticTrust. */
export const DEFAULT_TRUSTFLOW_API_BASE = "https://api.trustflow.systems";

export interface AuditFactor {
  id?: string;
  label?: string;
  points?: number;
  max?: number;
  state?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface DomainAudit {
  score: number | null;
  max?: number;
  headline?: string;
  brand?: string;
  factors: AuditFactor[];
  recommendations?: unknown[];
}

export interface AuditDomainResult {
  domain: string;
  status: string;
  isVerified: boolean;
  audit: DomainAudit;
  reason?: string;
  checkedAt?: string;
  claims?: Record<string, unknown>;
  /** Request URL, including the domain query. */
  source: string;
}

export interface AuditDomainInput {
  domain: string;
  /** Override the API origin. Tests pass a local base so CI never calls the network. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export async function auditDomain(input: AuditDomainInput): Promise<AuditDomainResult> {
  const domain = normalizeDomain(input.domain);
  const apiBase = resolveApiBase(input.baseUrl);
  const source = `${apiBase}/v1/verify?domain=${encodeURIComponent(domain)}`;
  const fetchFn = input.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchFn(source, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    throw new Error(`Trustflow verify request failed: ${message}`);
  }

  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Trustflow verify returned invalid JSON (HTTP ${response.status})`);
    }
  }

  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : text.slice(0, 300);
    throw new Error(`Trustflow verify HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const body = asRecord(parsed);
  if (!body) {
    throw new Error("Trustflow verify returned an unexpected payload");
  }

  const status = typeof body.status === "string" && body.status.trim() ? body.status : "UNVERIFIED";
  const auditRecord = asRecord(body.audit);
  const claims = asRecord(body.claims);
  const score = readScore(body, auditRecord, claims);
  const factors = readFactors(auditRecord);

  const result: AuditDomainResult = {
    domain: typeof body.domain === "string" && body.domain.trim() ? body.domain : domain,
    status,
    isVerified: readIsVerified(body, status),
    audit: {
      score,
      factors,
    },
    source,
  };

  const max = readNumber(auditRecord?.max);
  if (max !== undefined) result.audit.max = max;
  if (typeof auditRecord?.headline === "string") result.audit.headline = auditRecord.headline;
  if (typeof auditRecord?.brand === "string") result.audit.brand = auditRecord.brand;
  if (Array.isArray(auditRecord?.recommendations)) {
    result.audit.recommendations = auditRecord.recommendations;
  }
  if (typeof body.reason === "string") result.reason = body.reason;
  if (typeof body.checkedAt === "string") result.checkedAt = body.checkedAt;
  if (claims) result.claims = claims;
  return result;
}

export function resolveApiBase(input?: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return DEFAULT_TRUSTFLOW_API_BASE;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Trustflow API base URL: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Trustflow API base URL must use http or https");
  }

  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1/verify")) path = path.slice(0, -"/v1/verify".length);
  const suffix = path === "/" ? "" : path;
  return `${url.origin}${suffix}`;
}

function readIsVerified(body: Record<string, unknown>, status: string): boolean {
  if (typeof body.isVerified === "boolean") return body.isVerified;
  if (typeof body.verified === "boolean") return body.verified;
  return status.toUpperCase() === "VERIFIED";
}

function readScore(
  body: Record<string, unknown>,
  audit: Record<string, unknown> | undefined,
  claims: Record<string, unknown> | undefined
): number | null {
  const candidates = [
    audit?.score,
    body.trustScore,
    body.trust_score,
    body.score,
    claims?.trustScore,
    claims?.trust_score,
    claims?.score,
  ];
  for (const candidate of candidates) {
    const score = readNumber(candidate);
    if (score !== undefined) return score;
  }
  return null;
}

function readFactors(audit: Record<string, unknown> | undefined): AuditFactor[] {
  const raw = audit?.factors ?? audit?.scoreFactors;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = asRecord(item);
    return record ? { ...record } : { detail: String(item) };
  });
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
