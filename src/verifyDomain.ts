import { defaultCache } from "./cache.js";
import { importPublicKey, verifyDidJws, fingerprintPem } from "./jws.js";
import {
  normalizeDomain,
  didWebId,
  wellKnownDidUrl,
  wellKnownLlmsUrl,
  assertHttpsEndpoint,
} from "./tls.js";
import type {
  DidDocument,
  DomainClaims,
  EndpointInspectionResult,
  VerifyDomainOptions,
  VerifyResult,
} from "./types.js";

const DEFAULT_API =
  (typeof process !== "undefined" && process.env?.VERIFICATION_API_URL) ||
  "http://localhost:8787";

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1h — hits stay <50ms

function getFetch(opts?: VerifyDomainOptions): typeof fetch {
  return opts?.fetch ?? globalThis.fetch.bind(globalThis);
}

async function softFetchLlms(
  domain: string,
  fetchFn: typeof fetch
): Promise<{ present: boolean; summary?: string }> {
  try {
    const res = await fetchFn(wellKnownLlmsUrl(domain), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { present: false };
    const text = await res.text();
    const summary = text.slice(0, 280).replace(/\s+/g, " ").trim();
    return { present: true, summary };
  } catch {
    return { present: false };
  }
}

function extractMcpEndpoints(did: DidDocument): string[] {
  return (did.service ?? [])
    .filter(
      (s) =>
        /mcp/i.test(s.type) ||
        /mcp/i.test(s.id) ||
        s.serviceEndpoint.includes("mcp")
    )
    .map((s) => s.serviceEndpoint);
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
  let res: Response;
  try {
    res = await fetchFn(wellKnownDidUrl(domain), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null; // network / TLS failure → fall through to API
  }

  if (!res.ok) {
    return {
      status: "UNVERIFIED",
      domain,
      claims: {},
      reason: `did.json returned HTTP ${res.status}`,
      checkedAt: new Date().toISOString(),
    };
  }

  let did: DidDocument;
  try {
    did = (await res.json()) as DidDocument;
  } catch {
    return {
      status: "RISK",
      domain,
      claims: {},
      reason: "did.json is not valid JSON",
      checkedAt: new Date().toISOString(),
    };
  }

  const expectedDid = didWebId(domain);
  if (did.id && did.id !== expectedDid && did.id !== `did:web:${domain.replace(/\./g, ":")}`) {
    // allow did:web:example.com and path-encoded forms; flag clear mismatches
    if (!did.id.startsWith("did:web:")) {
      return {
        status: "RISK",
        domain,
        claims: { did: did.id },
        reason: "DID id is not did:web",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  const key = await importPublicKey(did);
  const pem = did.verificationMethod?.[0]?.publicKeyPem;
  const keyFp = pem ? fingerprintPem(pem) : undefined;
  const llms = await softFetchLlms(domain, fetchFn);
  const claims = buildClaims(domain, did, llms, keyFp);

  if (!key) {
    return {
      status: "UNVERIFIED",
      domain,
      claims,
      reason: "No usable public key in DID verificationMethod",
      checkedAt: new Date().toISOString(),
    };
  }

  if (!did.proof?.jws) {
    return {
      status: "UNVERIFIED",
      domain,
      claims,
      reason: "DID document has no JWS proof",
      checkedAt: new Date().toISOString(),
    };
  }

  const jwsResult = await verifyDidJws(did, key);
  if (!jwsResult.ok) {
    return {
      status: "RISK",
      domain,
      claims,
      reason: jwsResult.reason ?? "Signature verification failed",
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    status: "VERIFIED",
    domain,
    claims,
    checkedAt: new Date().toISOString(),
  };
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
      return {
        status: "UNVERIFIED",
        domain,
        claims: {},
        reason: `Verification API HTTP ${res.status}`,
        checkedAt: new Date().toISOString(),
      };
    }
    const body = (await res.json()) as VerifyResult;
    return {
      status: body.status,
      domain: body.domain ?? domain,
      claims: body.claims ?? {},
      reason: body.reason,
      cached: body.cached,
      checkedAt: body.checkedAt ?? new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "UNVERIFIED",
      domain,
      claims: {},
      reason:
        err instanceof Error
          ? `API fallback failed: ${err.message}`
          : "API fallback failed",
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * Verify a domain against the **AgenticTrust** protocol (`did:web` DID signature + JWS),
 * with central API fallback. Cache-first path targets <50ms on repeat lookups.
 *
 * Import from `@agentic-trust/sdk`.
 */
export async function verifyDomain(
  domainUrl: string,
  options: VerifyDomainOptions = {}
): Promise<VerifyResult> {
  const domain = normalizeDomain(domainUrl);
  const cacheKey = `verify:${domain}`;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (!options.bypassCache) {
    const hit = defaultCache.get(cacheKey);
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

  defaultCache.set(cacheKey, { ...result, cached: false }, ttl);
  return result;
}

/**
 * AgenticTrust SDK gate for MCP / tool endpoints before agent execution.
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
}
