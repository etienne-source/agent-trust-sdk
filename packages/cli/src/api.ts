/** Production Trustflow Systems verification API. */
export const TRUSTFLOW_API_BASE = "https://api.trustflow.systems";

export type VerificationType = "SSL_CHALLENGE" | "DNS_TXT";

export interface RegisterRequest {
  domain: string;
  businessName: string;
  verificationType: VerificationType;
  did?: string;
  /** SPKI PEM. The live API stores this and sets `publicKeyHash` from it. */
  publicKeyPem?: string;
  publicKeyHash?: string;
  /** Public did.json URL. Stored on the challenge; not a secret. */
  manifestUrl?: string;
  services?: string[];
}

export interface RegisterChallenge {
  domain: string;
  verificationType: VerificationType;
  challengeToken: string;
  challengePath?: string;
  dnsRecord?: { name: string; value: string };
  instructions: string;
  expiresAt: string;
  tier?: string;
}

export interface ConfirmRequest {
  domain: string;
  challengeToken: string;
  did?: string;
  publicKeyHash?: string;
  services?: string[];
  businessName?: string;
}

export class TrustflowApiError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "TrustflowApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Resolve the API origin used for `/v1/register` and `/v1/register/confirm`.
 *
 * The live routes are on `https://api.trustflow.systems`. The site paths
 * `https://trustflow.systems/api` and `https://trustflow.systems/api/register`
 * (and the `www` host) are aliases of that origin — they are not separate APIs.
 * A full `.../v1/register` URL is reduced to its origin + prefix.
 */
export function resolveTrustflowApiBase(input?: string | null): string {
  const raw = (input ?? "").trim();
  if (!raw) return TRUSTFLOW_API_BASE;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Trustflow API URL: ${input}`);
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const siteAlias =
    (host === "trustflow.systems" || host === "www.trustflow.systems") &&
    (path === "/api" ||
      path === "/api/register" ||
      path === "/api/v1/register" ||
      path === "/api/v1/register/confirm");
  if (siteAlias) return TRUSTFLOW_API_BASE;

  if (path.endsWith("/v1/register/confirm")) {
    return joinOrigin(url, path.slice(0, -"/v1/register/confirm".length));
  }
  if (path.endsWith("/v1/register")) {
    return joinOrigin(url, path.slice(0, -"/v1/register".length));
  }
  return joinOrigin(url, path === "/" ? "" : path);
}

function joinOrigin(url: URL, path: string): string {
  const suffix = path.replace(/\/+$/, "");
  return `${url.origin}${suffix}`;
}

export async function registerDomain(
  apiBase: string,
  body: RegisterRequest,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<RegisterChallenge> {
  const payload = await postJson(`${apiBase}/v1/register`, body, fetchFn);
  const challenge = payload as Partial<RegisterChallenge>;
  if (!challenge.challengeToken || !challenge.instructions || !challenge.domain) {
    throw new TrustflowApiError(
      "Register response is missing challengeToken, instructions, or domain",
      200,
      payload
    );
  }
  return challenge as RegisterChallenge;
}

export async function confirmRegistration(
  apiBase: string,
  body: ConfirmRequest,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<Record<string, unknown>> {
  const payload = await postJson(`${apiBase}/v1/register/confirm`, body, fetchFn);
  return payload;
}

async function postJson(
  url: string,
  body: unknown,
  fetchFn: typeof fetch
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    throw new TrustflowApiError(`Trustflow API request failed: ${message}`);
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }

  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const record = parsed as { error?: unknown; detail?: unknown; hint?: unknown };
    const message = [record.error, record.detail, record.hint]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" — ");
    throw new TrustflowApiError(message || `Trustflow API HTTP ${response.status}`, response.status, parsed);
  }

  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    throw new TrustflowApiError(
      `Trustflow API HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
      parsed
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new TrustflowApiError("Trustflow API returned a non-JSON body", response.status, parsed);
  }
  return parsed as Record<string, unknown>;
}
