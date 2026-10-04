import { hashLlmsTxt, hashPublicKeyPem } from "./identity.js";
import { assessDidDocument, fetchDidDocument } from "./localDid.js";
import {
  didWebId,
  rootLlmsUrl,
  sameSiteRedirect,
  secureApiBase,
  wellKnownDidUrl,
  wellKnownLlmsUrl,
} from "./tls.js";
import type { DidDocument, DomainClaims, VerificationStatus, VerifyResult } from "./types.js";

/** Per-request deadlines used when the caller does not pass one shared signal. */
export const LOCAL_DID_TIMEOUT_MS = 8_000;
export const LLMS_TIMEOUT_MS = 5_000;
export const REGISTRY_TIMEOUT_MS = 10_000;

export interface TrustCoreOptions {
  fetchFn: typeof fetch;
  apiBase: string;
  /** One signal for every request. When omitted each request gets its own timeout. */
  signal?: AbortSignal;
  /** Extra query parameters for `GET /v1/verify`. */
  registryQuery?: Record<string, string>;
}

export interface TrustEvaluation {
  result: VerifyResult;
  /** True when the outcome rests on a transport failure, so callers cache it briefly. */
  transient: boolean;
}

interface LlmsCopy {
  url: string;
  present: boolean;
  sha256?: string;
  summary?: string;
  failed?: boolean;
}

type LocalOutcome =
  | { kind: "verified"; result: VerifyResult; keyHash?: string; llmsTxtSha256?: string; transient: boolean }
  | { kind: "risk"; result: VerifyResult; transient: boolean }
  | { kind: "unverified"; result: VerifyResult }
  | { kind: "network"; error: unknown };

interface RegistryAnswer {
  result: VerifyResult;
  /** True when the registry could not be reached or answered with a server error. */
  transport: boolean;
}

function now(): string {
  return new Date().toISOString();
}

export function makeResult(
  domain: string,
  status: VerificationStatus,
  extra: Partial<VerifyResult> = {}
): VerifyResult {
  return { status, domain, claims: {}, checkedAt: now(), ...extra };
}

function signalFor(options: TrustCoreOptions, timeoutMs: number): AbortSignal {
  return options.signal ?? AbortSignal.timeout(timeoutMs);
}

async function fetchLlmsCopy(url: string, options: TrustCoreOptions): Promise<LlmsCopy> {
  try {
    const init = { method: "GET", redirect: "manual" as const, signal: signalFor(options, LLMS_TIMEOUT_MS) };
    let response = await options.fetchFn(url, init);
    if (response.status >= 300 && response.status < 400) {
      const next = sameSiteRedirect(url, response.headers.get("location"));
      if (next) response = await options.fetchFn(next, { ...init, signal: signalFor(options, LLMS_TIMEOUT_MS) });
    }
    if (!response.ok) return { url, present: false };
    // An SPA fallback page is not an llms.txt manifest.
    if (/text\/html/i.test(response.headers.get("content-type") ?? "")) return { url, present: false };
    const text = await response.text();
    return {
      url,
      present: true,
      sha256: hashLlmsTxt(text),
      summary: text.slice(0, 280).replace(/\s+/g, " ").trim(),
    };
  } catch {
    return { url, present: false, failed: true };
  }
}

function isMcpService(service: { id: string; type: string; serviceEndpoint: string }): boolean {
  if (/(^|[^a-z])mcp$/i.test(service.type)) return true;
  if (service.id.toLowerCase().endsWith("#mcp")) return true;
  try {
    return new URL(service.serviceEndpoint).pathname
      .split("/")
      .filter(Boolean)
      .some((part) => part.toLowerCase() === "mcp");
  } catch {
    return false;
  }
}

function buildClaims(domain: string, did: DidDocument, llms: LlmsCopy[], keyFp?: string): DomainClaims {
  const services = Array.isArray(did.service) ? did.service : [];
  const published = llms.find((copy) => copy.present);
  return {
    did: did.id || didWebId(domain),
    services: services.map((s) => ({ id: s.id, type: s.type, serviceEndpoint: s.serviceEndpoint })),
    manifestUrl: wellKnownDidUrl(domain),
    llmsTxtPresent: Boolean(published),
    llmsTxtSummary: published?.summary,
    publicKeyFingerprint: keyFp,
    mcpEndpoints: services.filter(isMcpService).map((service) => service.serviceEndpoint),
  };
}

function llmsProblem(signed: string | undefined, copies: LlmsCopy[]): string | undefined {
  const published = copies.filter((copy) => copy.present);
  if (!signed) {
    return published.length > 0
      ? `llms.txt is published at ${published.map((copy) => new URL(copy.url).pathname).join(" and ")} but did.json does not sign it`
      : undefined;
  }
  if (published.length === 0) return "Signed llms.txt is not published";
  const mismatch = published.find((copy) => copy.sha256 !== signed);
  if (mismatch) return `${new URL(mismatch.url).pathname} does not match the signed hash (llms.txt does not match the signed hash)`;
  return undefined;
}

async function evaluateLocal(domain: string, options: TrustCoreOptions): Promise<LocalOutcome> {
  const loaded = await fetchDidDocument(domain, options.fetchFn, signalFor(options, LOCAL_DID_TIMEOUT_MS));
  if (loaded.kind === "network") return { kind: "network", error: loaded.error };
  if (loaded.kind === "http") {
    return { kind: "unverified", result: makeResult(domain, "UNVERIFIED", { reason: `did.json returned HTTP ${loaded.status}` }) };
  }
  if (loaded.kind === "invalid-json") {
    return { kind: "risk", result: makeResult(domain, "RISK", { reason: "did.json is not valid JSON" }), transient: false };
  }

  const assessment = await assessDidDocument(domain, loaded.body);
  if (assessment.outcome === "malformed") {
    return { kind: "risk", result: makeResult(domain, "RISK", { reason: assessment.reason }), transient: false };
  }
  if (assessment.outcome === "risk" && assessment.reason === "DID id is not did:web") {
    return {
      kind: "risk",
      result: makeResult(domain, "RISK", {
        claims: assessment.didId ? { did: assessment.didId } : {},
        reason: assessment.reason,
      }),
      transient: false,
    };
  }

  const pem = assessment.did.verificationMethod?.[0]?.publicKeyPem;
  const keyFp = typeof pem === "string" ? hashPublicKeyPem(pem) : undefined;

  if (assessment.outcome === "incomplete") {
    return {
      kind: "unverified",
      result: makeResult(domain, "UNVERIFIED", { claims: buildClaims(domain, assessment.did, [], keyFp), reason: assessment.reason }),
    };
  }
  if (assessment.outcome === "risk") {
    return {
      kind: "risk",
      result: makeResult(domain, "RISK", {
        claims: buildClaims(domain, assessment.did, [], keyFp),
        reason: assessment.reason,
      }),
      transient: false,
    };
  }

  const copies = await Promise.all([
    fetchLlmsCopy(wellKnownLlmsUrl(domain), options),
    fetchLlmsCopy(rootLlmsUrl(domain), options),
  ]);
  const transient = copies.some((copy) => copy.failed);
  const claims: DomainClaims = {
    ...buildClaims(domain, assessment.did, copies, keyFp),
    ...(assessment.llmsTxtSha256 ? { llmsTxtSha256: assessment.llmsTxtSha256 } : {}),
  };
  const problem = llmsProblem(assessment.llmsTxtSha256, copies);
  if (problem) {
    return { kind: "risk", result: makeResult(domain, "RISK", { claims, reason: problem }), transient };
  }
  return {
    kind: "verified",
    result: makeResult(domain, "VERIFIED", { claims }),
    keyHash: keyFp,
    llmsTxtSha256: assessment.llmsTxtSha256,
    transient,
  };
}

function isStatus(value: unknown): value is VerificationStatus {
  return value === "VERIFIED" || value === "UNVERIFIED" || value === "RISK";
}

function readStatus(body: Record<string, unknown>): VerificationStatus | undefined {
  const raw = typeof body.status === "string" ? body.status.toUpperCase() : "";
  if (isStatus(raw)) return raw;
  if (body.verified === true || body.isVerified === true) return "VERIFIED";
  return undefined;
}

function claimsOf(value: unknown): DomainClaims {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as DomainClaims) };
  return {};
}

function registryError(err: unknown): string {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "API fallback failed: verification timed out";
  }
  return err instanceof Error ? `API fallback failed: ${err.message}` : "API fallback failed";
}

async function queryRegistry(domain: string, options: TrustCoreOptions): Promise<RegistryAnswer> {
  let base: string;
  try {
    base = secureApiBase(options.apiBase);
  } catch (err) {
    return {
      result: makeResult(domain, "UNVERIFIED", { reason: err instanceof Error ? err.message : String(err) }),
      transport: true,
    };
  }
  const query = new URLSearchParams({ domain, ...(options.registryQuery ?? {}) });
  try {
    const res = await options.fetchFn(`${base}/v1/verify?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: signalFor(options, REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        result: makeResult(domain, "UNVERIFIED", { reason: `Verification API HTTP ${res.status}` }),
        transport: res.status >= 500 || res.status === 429 || res.status === 408,
      };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { result: makeResult(domain, "UNVERIFIED", { reason: "Verification API returned invalid JSON" }), transport: true };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        result: makeResult(domain, "UNVERIFIED", { reason: "Verification API returned an unexpected payload" }),
        transport: true,
      };
    }
    const record = body as Record<string, unknown>;
    const status = readStatus(record);
    if (!status) {
      return {
        result: makeResult(domain, "UNVERIFIED", { reason: "Verification API returned an unexpected payload" }),
        transport: true,
      };
    }
    const claims: Record<string, unknown> = claimsOf(record.claims);
    for (const key of ["trustScore", "trust_score", "score", "did"] as const) {
      if (claims[key] === undefined && record[key] !== undefined) claims[key] = record[key];
    }
    // The registry answers for the domain that was asked; a different `domain` in the body is ignored.
    return {
      result: makeResult(domain, status, {
        claims: claims as DomainClaims,
        checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : now(),
        ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
      }),
      transport: false,
    };
  } catch (err) {
    return { result: makeResult(domain, "UNVERIFIED", { reason: registryError(err) }), transport: true };
  }
}

const REGISTRY_SCORE_KEYS = ["trustScore", "trust_score", "score", "verificationType", "verifiedAt", "businessName"] as const;

function lowerHex(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function combineVerified(
  local: Extract<LocalOutcome, { kind: "verified" }>,
  registry: RegistryAnswer
): VerifyResult {
  const domain = local.result.domain;
  const reg = registry.result;
  const registryStatus = registry.transport ? "unreachable" : reg.status;
  const claims: Record<string, unknown> = { ...local.result.claims, registryStatus };

  if (!registry.transport && reg.status === "RISK") {
    return makeResult(domain, "RISK", {
      claims,
      reason: `Trustflow registry marked the domain RISK${reg.reason ? `: ${reg.reason}` : ""}`,
    });
  }
  const registeredKey = lowerHex(reg.claims.publicKeyHash);
  if (!registry.transport && registeredKey && local.keyHash && registeredKey !== local.keyHash) {
    return makeResult(domain, "RISK", {
      claims,
      reason: "did.json key does not match the key registered with Trustflow",
    });
  }
  const registeredLlms = lowerHex(reg.claims.llmsTxtSha256);
  if (!registry.transport && registeredLlms && registeredLlms !== local.llmsTxtSha256) {
    return makeResult(domain, "RISK", {
      claims,
      reason: "Signed llms.txt does not match the hash registered with Trustflow",
    });
  }
  if (!registry.transport && reg.status === "VERIFIED") {
    for (const key of REGISTRY_SCORE_KEYS) {
      if (reg.claims[key] !== undefined) claims[key] = reg.claims[key];
    }
    if (registeredKey) claims.publicKeyHash = registeredKey;
  }
  return makeResult(domain, "VERIFIED", {
    claims,
    ...(registry.transport ? { reason: `Local did:web verified; registry not checked (${reg.reason ?? "unreachable"})` } : {}),
  });
}

/**
 * The one verification decision used by `verifyDomain` and the middleware.
 *
 * - A local JWS failure, a swapped llms.txt, or an llms.txt the JWS does not cover is `RISK`.
 * - A local `VERIFIED` is always checked against the registry. A registry `RISK`, a different
 *   registered key, or a different registered llms.txt hash turns it into `RISK`.
 * - When there is no usable local proof, the registry answer is used.
 */
export async function evaluateDomainTrust(domain: string, options: TrustCoreOptions): Promise<TrustEvaluation> {
  const local = await evaluateLocal(domain, options);
  if (local.kind === "risk") return { result: local.result, transient: local.transient };

  const registry = await queryRegistry(domain, options);
  if (local.kind === "verified") {
    return { result: combineVerified(local, registry), transient: registry.transport || local.transient };
  }

  const reg = registry.result;
  if (reg.status === "VERIFIED" || reg.status === "RISK") {
    return { result: reg, transient: registry.transport };
  }
  const base = local.kind === "unverified" ? local.result : reg;
  return {
    result: { ...base, status: "UNVERIFIED", reason: reg.reason ?? base.reason },
    transient: registry.transport || local.kind === "network",
  };
}
