import { defaultCache, type MemoryCache } from "./cache.js";
import { evaluateDomainTrust, makeResult } from "./trustCore.js";
import { normalizeDomain, assertHttpsEndpoint } from "./tls.js";
import type { EndpointInspectionResult, VerifyDomainOptions, VerifyResult } from "./types.js";

const DEFAULT_API = "https://api.trustflow.systems";

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1h — warm in-memory hits stay under 5ms
/** Results that rest on a transport failure are rechecked soon. */
const TRANSIENT_CACHE_TTL_MS = 15_000;

function getFetch(opts?: VerifyDomainOptions): typeof fetch {
  return opts?.fetch ?? globalThis.fetch.bind(globalThis);
}

function defaultApiBase(): string {
  const fromEnv = typeof process !== "undefined" ? process.env?.VERIFICATION_API_URL?.trim() : undefined;
  return fromEnv || DEFAULT_API;
}

/**
 * Verify a domain against the **Trustflow** protocol (`did:web` DID signature + JWS)
 * and the Trustflow Systems registry. A warm in-memory cache hit stays under 5ms.
 *
 * `VERIFIED` means the local did:web proof is ok and the registry status is
 * `VERIFIED` with the same `publicKeyHash`. A valid local signature without
 * that confirmation is `UNVERIFIED` with `signature: "VALID"`. No local proof
 * is never `VERIFIED`. A registry `RISK` or a different key is `RISK`.
 * A published llms.txt (at `/.well-known/llms.txt` or `/llms.txt`) that the JWS does
 * not sign, or that does not match the signed hash, is `RISK`.
 */
export async function verifyDomain(
  domainUrl: string,
  options: VerifyDomainOptions = {}
): Promise<VerifyResult> {
  let domain: string;
  try {
    domain = normalizeDomain(domainUrl);
  } catch {
    return makeResult(domainUrl.trim() || "(empty)", "UNVERIFIED", { reason: "Invalid domain" });
  }
  const cacheKey = `verify:${domain}`;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache: MemoryCache = options.cache ?? defaultCache;

  if (!options.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  const { result, transient } = await evaluateDomainTrust(domain, {
    fetchFn: getFetch(options),
    apiBase: options.verificationApiUrl ?? defaultApiBase(),
  });

  cache.set(cacheKey, { ...result, cached: false }, transient ? Math.min(ttl, TRANSIENT_CACHE_TTL_MS) : ttl);
  return result;
}

function endpointKey(value: string): string | undefined {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return undefined;
  }
}

/**
 * Trustflow SDK gate for MCP / tool endpoints before agent execution.
 * The endpoint must be HTTPS, its host must verify, and the URL must be one of the
 * MCP service endpoints signed into the domain's did.json.
 */
export async function inspectEndpointBeforeExecution(
  endpoint: string,
  options: VerifyDomainOptions = {}
): Promise<EndpointInspectionResult> {
  if (!assertHttpsEndpoint(endpoint)) {
    return { endpoint, allowed: false, status: "RISK", reason: "Endpoint must use HTTPS" };
  }

  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return { endpoint, allowed: false, status: "RISK", reason: "Invalid endpoint URL" };
  }

  const result = await verifyDomain(host, options);
  if (result.status === "RISK") {
    return { endpoint, allowed: false, status: "RISK", reason: result.reason ?? "Domain marked RISK" };
  }
  if (result.status !== "VERIFIED") {
    return { endpoint, allowed: false, status: result.status, reason: result.reason ?? "Domain not verified" };
  }
  const wanted = endpointKey(endpoint);
  const mcpList = result.claims.mcpEndpoints ?? [];
  if (mcpList.length === 0) {
    return {
      endpoint,
      allowed: false,
      status: "VERIFIED",
      reason: "Domain did.json lists no MCP service endpoints",
    };
  }
  const listed = mcpList.some((entry) => wanted !== undefined && endpointKey(entry) === wanted);
  if (!listed) {
    return { endpoint, allowed: false, status: "VERIFIED", reason: "Endpoint not listed in DID service endpoints" };
  }
  return { endpoint, allowed: true, status: "VERIFIED" };
}

export function clearVerifyCache(): void {
  defaultCache.clear();
}
