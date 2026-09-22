import { defaultCache } from "./cache.js";
import { fingerprintPem } from "./jws.js";
import { assessDidDocument, fetchDidDocument } from "./localDid.js";
import { normalizeDomain, didWebId, wellKnownDidUrl, wellKnownLlmsUrl, assertHttpsEndpoint, } from "./tls.js";
const DEFAULT_API = (typeof process !== "undefined" && process.env?.VERIFICATION_API_URL) ||
    "http://localhost:8787";
const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1h — hits stay <50ms
const LOCAL_DID_TIMEOUT_MS = 8_000;
function getFetch(opts) {
    return opts?.fetch ?? globalThis.fetch.bind(globalThis);
}
function checkedAt() {
    return new Date().toISOString();
}
function verifyResult(domain, status, extra = {}) {
    return {
        status,
        domain,
        claims: {},
        checkedAt: checkedAt(),
        ...extra,
    };
}
async function softFetchLlms(domain, fetchFn) {
    try {
        const res = await fetchFn(wellKnownLlmsUrl(domain), {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok)
            return { present: false };
        const text = await res.text();
        const summary = text.slice(0, 280).replace(/\s+/g, " ").trim();
        return { present: true, summary };
    }
    catch {
        return { present: false };
    }
}
function extractMcpEndpoints(did) {
    return (did.service ?? [])
        .filter((s) => /mcp/i.test(s.type) ||
        /mcp/i.test(s.id) ||
        s.serviceEndpoint.includes("mcp"))
        .map((s) => s.serviceEndpoint);
}
function buildClaims(domain, did, llms, keyFp) {
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
async function verifyLocalDid(domain, fetchFn) {
    const loaded = await fetchDidDocument(domain, fetchFn, AbortSignal.timeout(LOCAL_DID_TIMEOUT_MS));
    if (loaded.kind === "network")
        return null;
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
function isVerificationStatus(value) {
    return value === "VERIFIED" || value === "UNVERIFIED" || value === "RISK";
}
function claimsOf(value) {
    if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    return {};
}
async function verifyViaApi(domain, apiBase, fetchFn) {
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
        let body;
        try {
            body = await res.json();
        }
        catch {
            return verifyResult(domain, "UNVERIFIED", {
                reason: "Verification API returned invalid JSON",
            });
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return verifyResult(domain, "UNVERIFIED", {
                reason: "Verification API returned an unexpected payload",
            });
        }
        const record = body;
        if (!isVerificationStatus(record.status)) {
            return verifyResult(domain, "UNVERIFIED", {
                reason: "Verification API returned an unexpected payload",
            });
        }
        const extra = {
            claims: claimsOf(record.claims),
            checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : checkedAt(),
        };
        if (typeof record.reason === "string")
            extra.reason = record.reason;
        if (typeof record.cached === "boolean")
            extra.cached = record.cached;
        return verifyResult(record.domain ?? domain, record.status, extra);
    }
    catch (err) {
        return verifyResult(domain, "UNVERIFIED", {
            reason: err instanceof Error ? `API fallback failed: ${err.message}` : "API fallback failed",
        });
    }
}
/**
 * Verify a domain against the **AgenticTrust** protocol (`did:web` DID signature + JWS),
 * with central API fallback. Cache-first path targets <50ms on repeat lookups.
 *
 * Import from `@agentic-trust/sdk`. The hosted registry is Trustflow Systems
 * (`https://api.trustflow.systems`).
 */
export async function verifyDomain(domainUrl, options = {}) {
    let domain;
    try {
        domain = normalizeDomain(domainUrl);
    }
    catch {
        return verifyResult(domainUrl.trim() || "(empty)", "UNVERIFIED", {
            reason: "Invalid domain",
        });
    }
    const cacheKey = `verify:${domain}`;
    const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (!options.bypassCache) {
        const hit = defaultCache.get(cacheKey);
        if (hit)
            return hit;
    }
    const fetchFn = getFetch(options);
    const local = await verifyLocalDid(domain, fetchFn);
    let result;
    if (local && local.status === "VERIFIED") {
        result = local;
    }
    else if (local && local.status === "RISK") {
        // Local RISK is authoritative — do not upgrade via API
        result = local;
    }
    else {
        const apiBase = options.verificationApiUrl ?? DEFAULT_API;
        const apiResult = await verifyViaApi(domain, apiBase, fetchFn);
        // Prefer API VERIFIED; otherwise keep local reason if richer
        if (apiResult.status === "VERIFIED") {
            result = apiResult;
        }
        else if (local) {
            result = {
                ...local,
                reason: local.reason ?? apiResult.reason,
            };
        }
        else {
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
export async function inspectEndpointBeforeExecution(endpoint, options = {}) {
    if (!assertHttpsEndpoint(endpoint)) {
        return {
            endpoint,
            allowed: false,
            status: "RISK",
            reason: "Endpoint must use HTTPS",
        };
    }
    let host;
    try {
        host = new URL(endpoint).hostname;
    }
    catch {
        return {
            endpoint,
            allowed: false,
            status: "RISK",
            reason: "Invalid endpoint URL",
        };
    }
    const result = await verifyDomain(host, options);
    const mcpList = result.claims.mcpEndpoints ?? [];
    const listed = mcpList.length === 0 ||
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
        reason: result.status === "VERIFIED" && !listed
            ? "Endpoint not listed in DID service endpoints"
            : result.reason ?? "Domain not verified",
    };
}
export function clearVerifyCache() {
    defaultCache.clear();
}
//# sourceMappingURL=verifyDomain.js.map