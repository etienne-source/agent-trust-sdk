import { agenticTrustMiddleware, emitSecurityAlert, resolveEnforcementMode, securityAlertEvent, } from "@trustflow/sdk";
import { UnverifiedDomainContextError } from "./error.js";
import { cloneValue, collectContextTargets, collectLlmsPayloads, formatVerifiedLlms, parseLlmsTxt, readBody, writeVerifiedText, } from "./llms.js";
function sdkOptions(options) {
    const rest = { ...options };
    delete rest.verify;
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
function emptyContext(target, meta) {
    return {
        target,
        domain: meta.domain,
        sections: [],
        text: "",
        sourceText: "",
        agenticTrust: meta,
    };
}
async function readVerified(source, verify, strict, onAudit) {
    const meta = await checkDomain(source.target, verify, strict, onAudit);
    if (!trusted(meta))
        return emptyContext(source.target, meta);
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
 * Pass the result to `createMiddleware` from `langchain`. The default mode is
 * `"audit"`: unsigned context logs
 * `[Trustflow Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.`
 * and does not throw. `{ strict: true }` or `{ mode: "strict" }` throws
 * `UnverifiedDomainContextError` before any `llms.txt` body is read or parsed.
 */
export function agenticTrustLangChainMiddleware(options = {}) {
    const verify = createVerifier(options);
    const strict = isStrictMode(options);
    const onAudit = options.onAudit;
    return {
        name: "agenticTrust",
        async beforeModel(state) {
            if (!state || !Array.isArray(state.messages))
                return undefined;
            const messages = await rewriteVerified(state.messages, verify, strict, onAudit);
            if (messages === state.messages)
                return undefined;
            return { messages };
        },
        async wrapModelCall(request, handler) {
            return handler(await rewriteVerified(request, verify, strict, onAudit));
        },
        async wrapToolCall(request, handler) {
            return handler(await rewriteVerified(request, verify, strict, onAudit));
        },
        loadLlmsContext(source) {
            return readVerified(source, verify, strict, onAudit);
        },
    };
}
/** Verify with the SDK, then parse `llms.txt`. The body is untouched when verification fails. */
export async function loadVerifiedLlmsContext(source, options = {}) {
    return readVerified(source, createVerifier(options), isStrictMode(options), options.onAudit);
}
/**
 * Verify a domain. Strict mode throws `UnverifiedDomainContextError`.
 * Audit mode (the default) returns the metadata and emits the security alert.
 */
export async function assertVerifiedDomain(target, options = {}) {
    return checkDomain(target, createVerifier(options), isStrictMode(options), options.onAudit);
}
//# sourceMappingURL=middleware.js.map