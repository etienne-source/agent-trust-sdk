import { agenticTrustMiddleware, } from "@agentic-trust/sdk";
import { UnverifiedDomainContextError } from "./error.js";
import { cloneValue, collectContextTargets, collectLlmsPayloads, formatVerifiedLlms, parseLlmsTxt, readBody, writeVerifiedText, } from "./llms.js";
function sdkOptions(options) {
    const rest = { ...options };
    delete rest.verify;
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
async function readVerified(source, verify) {
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
/**
 * LangChain.js agent middleware.
 *
 * Pass the result to `createMiddleware` from `langchain`. `beforeModel`,
 * `wrapModelCall`, and `wrapToolCall` call `@agentic-trust/sdk` and throw
 * `UnverifiedDomainContextError` before any `llms.txt` body is read or parsed.
 */
export function agenticTrustLangChainMiddleware(options = {}) {
    const verify = createVerifier(options);
    return {
        name: "agenticTrust",
        async beforeModel(state) {
            if (!state || !Array.isArray(state.messages))
                return undefined;
            const messages = await rewriteVerified(state.messages, verify);
            if (messages === state.messages)
                return undefined;
            return { messages };
        },
        async wrapModelCall(request, handler) {
            return handler(await rewriteVerified(request, verify));
        },
        async wrapToolCall(request, handler) {
            return handler(await rewriteVerified(request, verify));
        },
        loadLlmsContext(source) {
            return readVerified(source, verify);
        },
    };
}
/** Verify with the SDK, then parse `llms.txt`. The body is untouched when verification fails. */
export async function loadVerifiedLlmsContext(source, options = {}) {
    return readVerified(source, createVerifier(options));
}
/** Verify a domain and throw `UnverifiedDomainContextError` when it is not signed. */
export async function assertVerifiedDomain(target, options = {}) {
    return requireVerifiedDomain(target, createVerifier(options));
}
//# sourceMappingURL=middleware.js.map