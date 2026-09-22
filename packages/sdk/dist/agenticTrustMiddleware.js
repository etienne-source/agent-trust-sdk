import { defaultCache } from "./cache.js";
import { importPublicKey, verifyDidJws } from "./jws.js";
import { didWebId, normalizeDomain, wellKnownDidUrl } from "./tls.js";
/** Registry used when no base URL is configured. */
export const DEFAULT_TRUST_API_URL = "https://api.trustflow.systems";
/** Verification calls abort after this long so a slow registry cannot stall an agent. */
export const DEFAULT_MIDDLEWARE_TIMEOUT_MS = 4_000;
/**
 * Successful registry answers are cached briefly.
 * Longer-lived entries written by `verifyDomain` are still reused.
 */
export const DEFAULT_MIDDLEWARE_CACHE_TTL_MS = 5 * 60 * 1000;
/** Transport failures are cached for a shorter window so a down API is not hammered. */
const FAILURE_CACHE_TTL_MS = 15_000;
const HEADER_NAME = "x-agentic-trust";
const WARNING_HEADER_NAME = "x-agentic-trust-warning";
function envUrl() {
    if (typeof process === "undefined")
        return undefined;
    const value = process.env?.AGENTIC_TRUST_API_URL || process.env?.VERIFICATION_API_URL;
    return value && value.trim() ? value.trim() : undefined;
}
function resolveOptions(options = {}) {
    const apiBase = (options.verificationApiUrl ?? envUrl() ?? DEFAULT_TRUST_API_URL).replace(/\/$/, "");
    return {
        apiBase,
        timeoutMs: options.timeoutMs ?? DEFAULT_MIDDLEWARE_TIMEOUT_MS,
        cacheTtlMs: options.cacheTtlMs ?? DEFAULT_MIDDLEWARE_CACHE_TTL_MS,
        bypassCache: options.bypassCache ?? false,
        fetchImpl: options.fetch ?? globalThis.fetch.bind(globalThis),
        headerName: options.headerName ?? HEADER_NAME,
        cache: options.cache ?? defaultCache,
    };
}
export function domainFromTarget(target) {
    const trimmed = target.trim();
    if (!trimmed) {
        throw new Error("Empty verification target");
    }
    if (/^did:web:/i.test(trimmed)) {
        const host = trimmed.slice("did:web:".length).split(":")[0]?.trim().toLowerCase();
        if (!host)
            throw new Error("Invalid did:web");
        return host;
    }
    return normalizeDomain(trimmed);
}
function readTrustScore(body) {
    const claims = body.claims && typeof body.claims === "object"
        ? body.claims
        : {};
    const candidates = [
        body.trustScore,
        body.trust_score,
        body.score,
        claims.trustScore,
        claims.trust_score,
        claims.score,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate))
            return candidate;
        if (typeof candidate === "string" && candidate.trim() && Number.isFinite(Number(candidate))) {
            return Number(candidate);
        }
    }
    return undefined;
}
function readDid(body, domain, verified) {
    const claims = body.claims && typeof body.claims === "object"
        ? body.claims
        : {};
    if (typeof body.did === "string" && body.did)
        return body.did;
    if (typeof claims.did === "string" && claims.did)
        return claims.did;
    return verified ? didWebId(domain) : undefined;
}
function unverified(domain, warning, status = "UNVERIFIED", did) {
    return {
        verified: false,
        securityWarning: true,
        warning,
        domain,
        status,
        ...(did ? { did } : {}),
    };
}
function isVerifiedStatus(body) {
    const statusRaw = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (statusRaw === "VERIFIED")
        return true;
    if (statusRaw === "UNVERIFIED" || statusRaw === "RISK")
        return false;
    return body.verified === true;
}
function metadataFromRegistry(domain, body) {
    const statusRaw = typeof body.status === "string" ? body.status.toUpperCase() : "";
    const verified = isVerifiedStatus(body);
    const trustScore = readTrustScore(body);
    const did = readDid(body, domain, verified);
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    if (verified) {
        return {
            verified: true,
            ...(trustScore !== undefined ? { trustScore } : {}),
            domain,
            status: "VERIFIED",
            ...(did ? { did } : {}),
        };
    }
    const status = statusRaw === "RISK" ? "RISK" : "UNVERIFIED";
    return unverified(domain, reason ?? (status === "RISK" ? "Domain marked RISK" : "Domain is not verified"), status, did);
}
function metadataFromCached(result) {
    return metadataFromRegistry(result.domain, {
        status: result.status,
        reason: result.reason,
        claims: result.claims,
        did: result.claims.did,
        trustScore: result.claims.trustScore,
        trust_score: result.claims.trust_score,
        score: result.claims.score,
    });
}
function toCacheValue(meta) {
    return {
        status: meta.status,
        domain: meta.domain,
        claims: {
            ...(meta.did ? { did: meta.did } : {}),
            ...(meta.trustScore !== undefined ? { trustScore: meta.trustScore } : {}),
        },
        reason: meta.warning,
        cached: false,
        checkedAt: new Date().toISOString(),
    };
}
function cacheKeys(domain) {
    return { sdk: `verify:${domain}`, middleware: `mw:verify:${domain}` };
}
function readCache(domain, options) {
    if (options.bypassCache)
        return undefined;
    const keys = cacheKeys(domain);
    const sdkHit = options.cache.get(keys.sdk);
    if (sdkHit)
        return metadataFromCached(sdkHit);
    const middlewareHit = options.cache.get(keys.middleware);
    if (middlewareHit)
        return metadataFromCached(middlewareHit);
    return undefined;
}
function errorWarning(err) {
    if (err instanceof Error) {
        if (err.name === "AbortError" || err.name === "TimeoutError") {
            return "Verification timed out; treating domain as unverified";
        }
        return `Verification unavailable: ${err.message}`;
    }
    return "Verification unavailable";
}
function isAbortError(err) {
    return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
/**
 * Local `did:web` check. `null` means "not authoritative" — caller pings the registry.
 * RISK and VERIFIED are terminal. Abort errors propagate so the caller fail-closes.
 */
async function lookupLocalDid(domain, options, signal) {
    let response;
    try {
        response = await options.fetchImpl(wellKnownDidUrl(domain), {
            method: "GET",
            headers: { Accept: "application/json" },
            redirect: "follow",
            signal,
        });
    }
    catch (err) {
        if (signal.aborted || isAbortError(err))
            throw err;
        return null;
    }
    if (!response.ok)
        return null;
    let body;
    try {
        body = await response.json();
    }
    catch {
        return {
            meta: unverified(domain, "did.json is not valid JSON", "RISK"),
            cacheTtlMs: options.cacheTtlMs,
        };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return {
            meta: unverified(domain, "did.json is not a DID document", "RISK"),
            cacheTtlMs: options.cacheTtlMs,
        };
    }
    const record = body;
    const did = body;
    const expected = didWebId(domain);
    if (did.id && did.id !== expected && !String(did.id).startsWith("did:web:")) {
        return {
            meta: unverified(domain, "DID id is not did:web", "RISK", did.id),
            cacheTtlMs: options.cacheTtlMs,
        };
    }
    const key = await importPublicKey(did);
    if (!key || !did.proof?.jws)
        return null;
    const jwsResult = await verifyDidJws(did, key);
    if (!jwsResult.ok) {
        return {
            meta: unverified(domain, jwsResult.reason ?? "Signature verification failed", "RISK", did.id || expected),
            cacheTtlMs: options.cacheTtlMs,
        };
    }
    const trustScore = readTrustScore(record);
    return {
        meta: {
            verified: true,
            ...(trustScore !== undefined ? { trustScore } : {}),
            domain,
            status: "VERIFIED",
            did: did.id || expected,
        },
        cacheTtlMs: options.cacheTtlMs,
    };
}
async function lookupApi(domain, options, signal) {
    const did = didWebId(domain);
    const url = `${options.apiBase}/v1/verify?domain=${encodeURIComponent(domain)}&did=${encodeURIComponent(did)}`;
    try {
        const response = await options.fetchImpl(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal,
        });
        if (!response.ok) {
            const transient = response.status >= 500;
            return {
                meta: unverified(domain, `Verification API HTTP ${response.status}`),
                cacheTtlMs: transient ? Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS) : options.cacheTtlMs,
            };
        }
        let body;
        try {
            body = await response.json();
        }
        catch {
            return {
                meta: unverified(domain, "Verification API returned invalid JSON"),
                cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
            };
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return {
                meta: unverified(domain, "Verification API returned an unexpected payload"),
                cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
            };
        }
        return {
            meta: metadataFromRegistry(domain, body),
            cacheTtlMs: options.cacheTtlMs,
        };
    }
    catch (err) {
        return {
            meta: unverified(domain, errorWarning(err)),
            cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
        };
    }
}
async function lookupTrust(domain, options) {
    const cached = readCache(domain, options);
    if (cached)
        return { meta: cached, cacheTtlMs: 0 };
    const signal = AbortSignal.timeout(options.timeoutMs);
    try {
        const local = await lookupLocalDid(domain, options, signal);
        if (local)
            return local;
    }
    catch (err) {
        return {
            meta: unverified(domain, errorWarning(err)),
            cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
        };
    }
    if (signal.aborted) {
        return {
            meta: unverified(domain, "Verification timed out; treating domain as unverified"),
            cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
        };
    }
    return lookupApi(domain, options, signal);
}
const inflight = new WeakMap();
async function settle(domain, options) {
    const lookup = await lookupTrust(domain, options);
    if (lookup.cacheTtlMs > 0) {
        options.cache.set(cacheKeys(domain).middleware, toCacheValue(lookup.meta), lookup.cacheTtlMs);
    }
    return lookup.meta;
}
async function verifyWithOptions(target, options) {
    let domain;
    try {
        domain = domainFromTarget(target);
    }
    catch (err) {
        const label = target.trim() || "(empty)";
        return unverified(label, err instanceof Error ? err.message : "Invalid verification target");
    }
    if (options.bypassCache)
        return settle(domain, options);
    let existing = inflight.get(options);
    if (!existing) {
        existing = new Map();
        inflight.set(options, existing);
    }
    const bucket = existing;
    const pending = bucket.get(domain);
    if (pending)
        return pending;
    const promise = settle(domain, options).finally(() => {
        if (bucket.get(domain) === promise)
            bucket.delete(domain);
    });
    bucket.set(domain, promise);
    return promise;
}
function compactHeader(meta) {
    const payload = { verified: meta.verified };
    if (meta.verified && meta.trustScore !== undefined)
        payload.trustScore = meta.trustScore;
    if (meta.securityWarning)
        payload.securityWarning = true;
    return JSON.stringify(payload);
}
function enrichPayload(parsed, meta) {
    const agenticTrust = meta;
    const warning = meta.securityWarning ? { securityWarning: true } : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...parsed, agenticTrust, ...warning };
    }
    return { data: parsed, agenticTrust, ...warning };
}
async function applyMetadata(response, meta, headerName) {
    const headers = new Headers(response.headers);
    headers.set(headerName, compactHeader(meta));
    if (meta.securityWarning)
        headers.set(WARNING_HEADER_NAME, "true");
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = /json/i.test(contentType);
    if (!isJson || response.status === 204 || response.status === 205) {
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
    const text = await response.text();
    headers.delete("content-length");
    let parsed;
    try {
        parsed = text.length ? JSON.parse(text) : null;
    }
    catch {
        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
    return new Response(JSON.stringify(enrichPayload(parsed, meta)), {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
function requestUrl(input) {
    if (typeof input === "string")
        return input;
    if (input instanceof URL)
        return input.toString();
    return input.url;
}
function hostnameOf(url) {
    try {
        return domainFromTarget(url);
    }
    catch {
        return undefined;
    }
}
function stricter(primary, other) {
    if (!primary.verified)
        return primary;
    if (!other.verified)
        return other;
    return primary;
}
const SOURCE_KEYS = ["url", "href", "domain", "endpoint", "link", "source", "pageUrl"];
function extractTarget(value, depth = 0) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^https?:\/\//i.test(trimmed) || /^did:web:/i.test(trimmed))
            return trimmed;
        return undefined;
    }
    if (!value || typeof value !== "object" || depth > 2)
        return undefined;
    const record = value;
    for (const key of SOURCE_KEYS) {
        const found = extractTarget(record[key], depth + 1);
        if (found)
            return found;
    }
    if (record.metadata) {
        const found = extractTarget(record.metadata, depth + 1);
        if (found)
            return found;
    }
    if (record.input) {
        const found = extractTarget(record.input, depth + 1);
        if (found)
            return found;
    }
    return undefined;
}
function mergeResult(result, meta) {
    if (Array.isArray(result) && result.every((item) => item && typeof item === "object" && "pageContent" in item)) {
        return result.map((item) => mergeResult(item, meta));
    }
    if (result && typeof result === "object" && !Array.isArray(result)) {
        const record = result;
        if (typeof record.pageContent === "string") {
            const metadata = record.metadata && typeof record.metadata === "object"
                ? record.metadata
                : {};
            return {
                ...record,
                metadata: {
                    ...metadata,
                    agenticTrust: meta,
                    ...(meta.securityWarning ? { securityWarning: true } : {}),
                },
            };
        }
        return enrichPayload(record, meta);
    }
    if (typeof result === "string") {
        return enrichPayload({ content: result }, meta);
    }
    return enrichPayload({ result }, meta);
}
function methodOf(tool, name) {
    const value = tool[name];
    return typeof value === "function" ? value : undefined;
}
function wrapMethod(method, tool, options) {
    return async function wrapped(input, ...rest) {
        const result = await method.call(tool, input, ...rest);
        const target = extractTarget(input) ?? extractTarget(result);
        if (!target)
            return result;
        const meta = await verifyWithOptions(target, options);
        return mergeResult(result, meta);
    };
}
/**
 * Demand-side verification middleware.
 *
 * When an agent fetches a domain, the wrapper checks local `did:web` (JWS)
 * or calls `GET {base}/v1/verify` and appends `{ verified, trustScore }`
 * metadata. Unverified domains and registry outages append `securityWarning: true`
 * and do not throw.
 *
 * @example
 * ```ts
 * const trust = agenticTrustMiddleware();
 * const context = await trust.annotateContext({ snippet }, "https://example.com");
 * const response = await trust.fetch("https://example.com/data.json");
 * ```
 */
export function agenticTrustMiddleware(options = {}) {
    const resolved = resolveOptions(options);
    const fetchWithTrust = async (input, init) => {
        const requested = requestUrl(input);
        const requestedHost = hostnameOf(requested);
        // Relative or unparseable URLs have no registry domain. Pass them through.
        if (!requestedHost) {
            return resolved.fetchImpl(input, init);
        }
        const verifyPromise = verifyWithOptions(requested, resolved);
        const response = await resolved.fetchImpl(input, init);
        let meta = await verifyPromise;
        const finalHost = response.url ? hostnameOf(response.url) : undefined;
        if (finalHost && finalHost !== meta.domain) {
            meta = stricter(meta, await verifyWithOptions(finalHost, resolved));
        }
        return applyMetadata(response, meta, resolved.headerName);
    };
    return {
        verify(target) {
            return verifyWithOptions(target, resolved);
        },
        async annotateContext(context, target) {
            const meta = await verifyWithOptions(target, resolved);
            return {
                ...context,
                agenticTrust: meta,
                ...(meta.securityWarning ? { securityWarning: true } : {}),
            };
        },
        async annotateDocuments(documents, fallbackUrl) {
            return Promise.all(documents.map(async (doc) => {
                const target = extractTarget(doc.metadata) ?? extractTarget(doc) ?? fallbackUrl;
                const meta = target
                    ? await verifyWithOptions(target, resolved)
                    : unverified("unknown", "Document has no source URL to verify");
                const metadata = {
                    ...(doc.metadata ?? {}),
                    agenticTrust: meta,
                    ...(meta.securityWarning ? { securityWarning: true } : {}),
                };
                return { ...doc, metadata };
            }));
        },
        fetch: fetchWithTrust,
        wrapTool(tool) {
            const invoke = methodOf(tool, "invoke");
            const call = methodOf(tool, "call");
            const execute = methodOf(tool, "execute");
            if (!invoke && !call && !execute)
                return tool;
            return new Proxy(tool, {
                get(target, prop, receiver) {
                    if (prop === "invoke" && invoke)
                        return wrapMethod(invoke, target, resolved);
                    if (prop === "call" && call)
                        return wrapMethod(call, target, resolved);
                    if (prop === "execute" && execute)
                        return wrapMethod(execute, target, resolved);
                    return Reflect.get(target, prop, receiver);
                },
            });
        },
    };
}
//# sourceMappingURL=agenticTrustMiddleware.js.map