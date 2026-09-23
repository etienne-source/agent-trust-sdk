import { defaultCache, type MemoryCache } from "./cache.js";
import { clearPublicKeyCache } from "./jws.js";
import { fingerprintPem } from "./jws.js";
import { hashLlmsTxt } from "./identity.js";
import { assessDidDocument, fetchDidDocument } from "./localDid.js";
import {
  normalizeDomain,
  didWebId,
  wellKnownDidUrl,
  wellKnownLlmsUrl,
  assertHttpsEndpoint,
  sameSiteRedirect,
} from "./tls.js";
import type {
  DidDocument,
  DomainClaims,
  EndpointInspectionResult,
  VerificationStatus,
  VerifyDomainOptions,
  VerifyResult,
} from "./types.js";

const DEFAULT_API =
  (typeof process !== "undefined" && process.env?.VERIFICATION_API_URL) ||
  "https://api.trustflow.systems";

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1h — warm in-memory hits stay under 5ms
const LOCAL_DID_TIMEOUT_MS = 8_000;

function getFetch(opts?: VerifyDomainOptions): typeof fetch {
  return opts?.fetch ?? globalThis.fetch.bind(globalThis);
}

function checkedAt(): string {
  return new Date().toISOString();
}

async function followSameSite(
  fetchFn: typeof fetch,
  url: string,
  response: Response
): Promise<Response> {
  if (response.status < 300 || response.status >= 400) return response;
  const next = sameSiteRedirect(url, response.headers.get("location"));
  if (!next) return response;
  return fetchFn(next, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
}

function verifyResult(
  domain: string,
  status: VerificationStatus,
  extra: Partial<VerifyResult> = {}
): VerifyResult {
  return {
    status,
    domain,
    claims: {},
    checkedAt: checkedAt(),
    ...extra,
  };
}

async function softFetchLlms(
  domain: string,
  fetchFn: typeof fetch
): Promise<{ present: boolean; summary?: string; sha256?: string }> {
  try {
    const res = await fetchFn(wellKnownLlmsUrl(domain), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const final = await followSameSite(fetchFn, wellKnownLlmsUrl(domain), res);
    if (!final.ok) return { present: false };
    const text = await final.text();
    const summary = text.slice(0, 280).replace(/\s+/g, " ").trim();
    return { present: true, summary, sha256: hashLlmsTxt(text) };
  } catch {
    return { present: false };
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

function extractMcpEndpoints(did: DidDocument): string[] {
  return (did.service ?? []).filter(isMcpService).map((service) => service.serviceEndpoint);
}

function buildClaims(
  domain: string,
  did: DidDocument,
  llms: { present: boolean; summary?: string },
  keyFp?: string
): DomainClaims {
  const services = did.service?.map((s) => ({
    id: s.id,
    type: s.type,
    serviceEndpoint: s.serviceEndpoint,
  }));
  return {
    did: did.id || didWebId(domain),
    businessName: undefined,
    services,
    manifestUrl: wellKnownDidUrl(domain),
    llmsTxtPresent: llms.present,
    llmsTxtSummary: llms.summary,
    publicKeyFingerprint: keyFp,
    mcpEndpoints: extractMcpEndpoints(did),
  };
}

async function verifyLocalDid(
  domain: string,
  fetchFn: typeof fetch
): Promise<VerifyResult | null> {
  const loaded = await fetchDidDocument(domain, fetchFn, AbortSignal.timeout(LOCAL_DID_TIMEOUT_MS));
  if (loaded.kind === "network") return null;
  if (loaded.kind === "http") {
    return verifyResult(domain, "UNVERIFIED", {
      reason: `did.json returned HTTP ${loaded.status}`,
    });
  }
  if (loaded.kind === "invalid-json") {
    return verifyResult(domain, "RISK", { reason: "did.json is not valid JSON" });
  }

  const assessment = await assessDidDocument(domain, loaded.body);
  if (assessment.outcome === "malformed") {
    return verifyResult(domain, "RISK", { reason: assessment.reason });
  }
  if (assessment.outcome === "risk" && assessment.reason === "DID id is not did:web") {
    return verifyResult(domain, "RISK", {
      claims: assessment.didId ? { did: assessment.didId } : {},
      reason: assessment.reason,
    });
  }

  const pem = assessment.did.verificationMethod?.[0]?.publicKeyPem;
  const keyFp = typeof pem === "string" ? fingerprintPem(pem) : undefined;
  const llms = await softFetchLlms(domain, fetchFn);
  const claims = buildClaims(domain, assessment.did, llms, keyFp);

  if (assessment.outcome === "verified") {
    if (assessment.llmsTxtSha256 && assessment.llmsTxtSha256 !== llms.sha256) {
      return verifyResult(domain, "RISK", {
        claims,
        reason: llms.present
          ? "llms.txt does not match the signed hash"
          : "Signed llms.txt is not published",
      });
    }
    return verifyResult(domain, "VERIFIED", { claims });
  }
  if (assessment.outcome === "risk") {
    return verifyResult(domain, "RISK", {
      claims,
      reason: assessment.reason,
    });
  }
  return verifyResult(domain, "UNVERIFIED", {
    claims,
    reason: assessment.reason,
  });
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
  return value === "VERIFIED" || value === "UNVERIFIED" || value === "RISK";
}

function claimsOf(value: unknown): DomainClaims {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as DomainClaims;
  return {};
}

async function verifyViaApi(
  domain: string,
  apiBase: string,
  fetchFn: typeof fetch
): Promise<VerifyResult> {
  try {
    const url = `${apiBase.replace(/\/$/, "")}/v1/verify?domain=${encodeURIComponent(domain)}`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return verifyResult(domain, "UNVERIFIED", {
        reason: `Verification API HTTP ${res.status}`,
      });
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return verifyResult(domain, "UNVERIFIED", {
        reason: "Verification API returned invalid JSON",
      });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return verifyResult(domain, "UNVERIFIED", {
        reason: "Verification API returned an unexpected payload",
      });
    }
    const record = body as Partial<VerifyResult>;
    if (!isVerificationStatus(record.status)) {
      return verifyResult(domain, "UNVERIFIED", {
        reason: "Verification API returned an unexpected payload",
      });
    }
    const extra: Partial<VerifyResult> = {
      claims: claimsOf(record.claims),
      checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : checkedAt(),
    };
    if (typeof record.reason === "string") extra.reason = record.reason;
    if (typeof record.cached === "boolean") extra.cached = record.cached;
    return verifyResult(record.domain ?? domain, record.status, extra);
  } catch (err) {
    return verifyResult(domain, "UNVERIFIED", {
      reason:
        err instanceof Error ? `API fallback failed: ${err.message}` : "API fallback failed",
    });
  }
}

/**
 * Verify a domain against the **Trustflow** protocol (`did:web` DID signature + JWS),
 * with central API fallback. A warm in-memory cache hit stays under 5ms.
 *
 * Import from `@trustflow/sdk`. The hosted registry is Trustflow Systems
 * (`https://api.trustflow.systems`).
 */
export async function verifyDomain(
  domainUrl: string,
  options: VerifyDomainOptions = {}
): Promise<VerifyResult> {
  let domain: string;
  try {
    domain = normalizeDomain(domainUrl);
  } catch {
    return verifyResult(domainUrl.trim() || "(empty)", "UNVERIFIED", {
      reason: "Invalid domain",
    });
  }
  const cacheKey = `verify:${domain}`;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache: MemoryCache = options.cache ?? defaultCache;

  if (!options.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  const fetchFn = getFetch(options);
  const local = await verifyLocalDid(domain, fetchFn);

  let result: VerifyResult;
  if (local && local.status === "VERIFIED") {
    result = local;
  } else if (local && local.status === "RISK") {
    // Local RISK is authoritative — do not upgrade via API
    result = local;
  } else {
    const apiBase = options.verificationApiUrl ?? DEFAULT_API;
    const apiResult = await verifyViaApi(domain, apiBase, fetchFn);
    // Prefer API VERIFIED; otherwise keep local reason if richer
    if (apiResult.status === "VERIFIED") {
      result = apiResult;
    } else if (local) {
      result = {
        ...local,
        reason: local.reason ?? apiResult.reason,
      };
    } else {
      result = apiResult;
    }
  }

  cache.set(cacheKey, { ...result, cached: false }, ttl);
  return result;
}

/**
 * Trustflow SDK gate for MCP / tool endpoints before agent execution.
 * Verifies the owning domain's DID signature and requires HTTPS.
 */
export async function inspectEndpointBeforeExecution(
  endpoint: string,
  options: VerifyDomainOptions = {}
): Promise<EndpointInspectionResult> {
  if (!assertHttpsEndpoint(endpoint)) {
    return {
      endpoint,
      allowed: false,
      status: "RISK",
      reason: "Endpoint must use HTTPS",
    };
  }

  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return {
      endpoint,
      allowed: false,
      status: "RISK",
      reason: "Invalid endpoint URL",
    };
  }

  const result = await verifyDomain(host, options);
  const mcpList = result.claims.mcpEndpoints ?? [];
  const listed =
    mcpList.length === 0 ||
    mcpList.some((e) => e.replace(/\/$/, "") === endpoint.replace(/\/$/, ""));

  if (result.status === "VERIFIED" && listed) {
    return { endpoint, allowed: true, status: "VERIFIED" };
  }
  if (result.status === "RISK") {
    return {
      endpoint,
      allowed: false,
      status: "RISK",
      reason: result.reason ?? "Domain marked RISK",
    };
  }
  return {
    endpoint,
    allowed: false,
    status: result.status,
    reason:
      result.status === "VERIFIED" && !listed
        ? "Endpoint not listed in DID service endpoints"
        : result.reason ?? "Domain not verified",
  };
}

export function clearVerifyCache(): void {
  defaultCache.clear();
  clearPublicKeyCache();
}
