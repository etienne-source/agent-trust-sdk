import { agenticTrustMiddleware, emitSecurityAlert, resolveEnforcementMode, securityAlertEvent, } from "@trustflow/sdk";
import { UnverifiedDomainContextError } from "./error.js";
import { cloneValue, collectContextTargets, collectLlmsPayloads, formatVerifiedLlms, isLlmsTxtUrl, parseLlmsTxt, readBody, writeVerifiedText, } from "./llms.js";
/** Request header that marks a fetch as domain context even when the path is not `llms.txt`. */
export const AGENTIC_TRUST_CONTEXT_HEADER = "x-agentic-trust-context";
function sdkOptions(options) {
    const rest = { ...options };
    delete rest.verify;
    delete rest.contextFetch;
    delete rest.failClosed;
    delete rest.mode;
    delete rest.strict;
    delete rest.onAudit;
    return rest;
}
export function createVerifier(options = {}) {
    if (options.verify)
        return options.verify;
    const trust = agenticTrustMiddleware(sdkOptions(options));
    return (target) => trust.verify(target);
}
export function isStrictMode(options = {}) {
    return resolveEnforcementMode(options) === "strict";
}
async function checkDomain(target, verify, strict, onAudit) {
    const meta = await verify(target);
    if (trusted(meta))
        return meta;
    if (strict)
        throw new UnverifiedDomainContextError(meta);
    emitSecurityAlert(securityAlertEvent(meta.domain, meta.status), onAudit);
    return meta;
}
function trusted(meta) {
    return Boolean(meta && meta.verified && !meta.securityWarning);
}
async function rewriteVerified(value, verify, strict, onAudit) {
    const sites = collectLlmsPayloads(value);
    const targets = new Set(collectContextTargets(value));
    for (const site of sites)
        targets.add(site.target);
    if (targets.size === 0)
        return value;
    const metas = new Map();
    for (const target of targets) {
        metas.set(target, await checkDomain(target, verify, strict, onAudit));
    }
    if (sites.length === 0)
        return value;
    const draft = cloneValue(value);
    let wrote = false;
    for (const site of sites) {
        const meta = metas.get(site.target);
        if (!trusted(meta))
            continue;
        writeVerifiedText(draft, site.path, formatVerifiedLlms(parseLlmsTxt(site.readContent()), meta));
        wrote = true;
    }
    return wrote ? draft : value;
}
function requestUrl(input) {
    if (typeof input === "string")
        return input;
    if (input instanceof URL)
        return input.toString();
    return input.url;
}
function headerValue(input, init, name) {
    const headers = new Headers(init?.headers);
    if (typeof Request !== "undefined" && input instanceof Request) {
        input.headers.forEach((value, key) => {
            if (!headers.has(key))
                headers.set(key, value);
        });
    }
    return headers.get(name);
}
function isContextFetch(input, init) {
    const url = requestUrl(input);
    if (isLlmsTxtUrl(url))
        return true;
    const mark = headerValue(input, init, AGENTIC_TRUST_CONTEXT_HEADER);
    return mark === "llms.txt" || mark === "domain";
}
function trustHeader(meta) {
    return JSON.stringify({
        verified: true,
        domain: meta.domain,
        ...(meta.trustScore !== undefined ? { trustScore: meta.trustScore } : {}),
    });
}
/**
 * Vercel AI SDK fetch and language-model middleware.
 *
 * Pass `fetch` to a provider factory and the object itself to `wrapLanguageModel`.
 * The default mode is `"audit"`: unsigned context logs
 * `[AgenticTrust Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.`
 * and does not throw. `{ strict: true }` or `{ mode: "strict" }` throws
 * `UnverifiedDomainContextError` before the response stream starts and before `llms.txt` is parsed.
 */
export function agenticTrustVercelAiMiddleware(options = {}) {
    const verify = createVerifier(options);
    const strict = isStrictMode(options);
    const onAudit = options.onAudit;
    const contextFetch = options.contextFetch ?? globalThis.fetch.bind(globalThis);
    const fetchWithTrust = async (input, init) => {
        if (!isContextFetch(input, init)) {
            return contextFetch(input, init);
        }
        const meta = await checkDomain(requestUrl(input), verify, strict, onAudit);
        if (!trusted(meta)) {
            return contextFetch(input, init);
        }
        const response = await contextFetch(input, init);
        const headers = new Headers(response.headers);
        headers.set("x-agentic-trust", trustHeader(meta));
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    };
    async function loadLlmsFromUrl(url) {
        const meta = await checkDomain(url, verify, strict, onAudit);
        if (!trusted(meta)) {
            return {
                target: url,
                domain: meta.domain,
                sections: [],
                text: "",
                sourceText: "",
                agenticTrust: meta,
            };
        }
        const response = await contextFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch llms.txt for ${meta.domain}: HTTP ${response.status}`);
        }
        const sourceText = await response.text();
        const parsed = parseLlmsTxt(sourceText);
        return {
            target: url,
            domain: meta.domain,
            ...parsed,
            text: formatVerifiedLlms(parsed, meta),
            sourceText,
            agenticTrust: meta,
        };
    }
    return {
        fetch: fetchWithTrust,
        async transformParams({ params }) {
            return rewriteVerified(params, verify, strict, onAudit);
        },
        async wrapGenerate({ doGenerate, params }) {
            await rewriteVerified(params, verify, strict, onAudit);
            return doGenerate();
        },
        async wrapStream({ doStream, params }) {
            await rewriteVerified(params, verify, strict, onAudit);
            return doStream();
        },
        loadLlmsFromUrl,
    };
}
/** Verify with the SDK, fetch the URL, then parse `llms.txt`. */
export async function loadVerifiedLlmsFromUrl(url, options = {}) {
    return agenticTrustVercelAiMiddleware(options).loadLlmsFromUrl(url);
}
/**
 * Verify a domain. Strict mode throws `UnverifiedDomainContextError`.
 * Audit mode (the default) returns the metadata and emits the security alert.
 */
export async function assertVerifiedDomain(target, options = {}) {
    return checkDomain(target, createVerifier(options), isStrictMode(options), options.onAudit);
}
export async function readVerifiedLlms(source, options = {}) {
    const verify = createVerifier(options);
    const meta = await checkDomain(source.target, verify, isStrictMode(options), options.onAudit);
    if (!meta.verified || meta.securityWarning) {
        return {
            target: source.target,
            domain: meta.domain,
            sections: [],
            text: "",
            sourceText: "",
            agenticTrust: meta,
        };
    }
    const sourceText = readBody(source.content);
    const parsed = parseLlmsTxt(sourceText);
    return {
        target: source.target,
        domain: meta.domain,
        ...parsed,
        text: formatVerifiedLlms(parsed, meta),
        sourceText,
        agenticTrust: meta,
    };
}
//# sourceMappingURL=middleware.js.map