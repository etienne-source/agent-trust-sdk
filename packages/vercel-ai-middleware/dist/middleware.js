import { agenticTrustMiddleware, } from "@agentic-trust/sdk";
import { UnverifiedDomainContextError } from "./error.js";
import { cloneValue, collectContextTargets, collectLlmsPayloads, formatVerifiedLlms, isLlmsTxtUrl, parseLlmsTxt, readBody, writeVerifiedText, } from "./llms.js";
/** Request header that marks a fetch as domain context even when the path is not `llms.txt`. */
export const AGENTIC_TRUST_CONTEXT_HEADER = "x-agentic-trust-context";
function sdkOptions(options) {
    const rest = { ...options };
    delete rest.verify;
    delete rest.contextFetch;
    return rest;
}
export function createVerifier(options = {}) {
    if (options.verify)
        return options.verify;
    const trust = agenticTrustMiddleware(sdkOptions(options));
    return (target) => trust.verify(target);
}
export async function requireVerifiedDomain(target, verify) {
    const meta = await verify(target);
    if (!meta.verified || meta.securityWarning) {
        throw new UnverifiedDomainContextError(meta);
    }
    return meta;
}
async function rewriteVerified(value, verify) {
    const sites = collectLlmsPayloads(value);
    const targets = new Set(collectContextTargets(value));
    for (const site of sites)
        targets.add(site.target);
    if (targets.size === 0)
        return value;
    const metas = new Map();
    for (const target of targets) {
        metas.set(target, await requireVerifiedDomain(target, verify));
    }
    if (sites.length === 0)
        return value;
    const draft = cloneValue(value);
    for (const site of sites) {
        const meta = metas.get(site.target);
        if (!meta)
            continue;
        writeVerifiedText(draft, site.path, formatVerifiedLlms(parseLlmsTxt(site.readContent()), meta));
    }
    return draft;
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
 * Unverified or unsigned domain context throws `UnverifiedDomainContextError`
 * before the response stream starts and before `llms.txt` is parsed.
 */
export function agenticTrustVercelAiMiddleware(options = {}) {
    const verify = createVerifier(options);
    const contextFetch = options.contextFetch ?? globalThis.fetch.bind(globalThis);
    const fetchWithTrust = async (input, init) => {
        if (!isContextFetch(input, init)) {
            return contextFetch(input, init);
        }
        const meta = await requireVerifiedDomain(requestUrl(input), verify);
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
        const meta = await requireVerifiedDomain(url, verify);
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
            return rewriteVerified(params, verify);
        },
        async wrapGenerate({ doGenerate, params }) {
            await rewriteVerified(params, verify);
            return doGenerate();
        },
        async wrapStream({ doStream, params }) {
            await rewriteVerified(params, verify);
            return doStream();
        },
        loadLlmsFromUrl,
    };
}
/** Verify with the SDK, fetch the URL, then parse `llms.txt`. */
export async function loadVerifiedLlmsFromUrl(url, options = {}) {
    return agenticTrustVercelAiMiddleware(options).loadLlmsFromUrl(url);
}
/** Verify a domain and throw `UnverifiedDomainContextError` when it is not signed. */
export async function assertVerifiedDomain(target, options = {}) {
    return requireVerifiedDomain(target, createVerifier(options));
}
export async function readVerifiedLlms(source, options = {}) {
    const verify = createVerifier(options);
    const meta = await requireVerifiedDomain(source.target, verify);
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