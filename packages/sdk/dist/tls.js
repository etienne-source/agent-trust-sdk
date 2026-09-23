/**
 * Domain / URL helpers and soft TLS-adjacent checks.
 * Full certificate-chain inspection requires Node tls sockets;
 * browser/SDK path relies on HTTPS fetch succeeding + DID key match.
 */
export function normalizeDomain(domainUrl) {
    let input = domainUrl.trim();
    if (!/^https?:\/\//i.test(input)) {
        input = `https://${input}`;
    }
    const url = new URL(input);
    return url.hostname.toLowerCase();
}
export function didWebId(domain) {
    // did:web:example.com  (path segments use :)
    return `did:web:${domain}`;
}
export function wellKnownDidUrl(domain) {
    return `https://${domain}/.well-known/did.json`;
}
export function wellKnownLlmsUrl(domain) {
    return `https://${domain}/.well-known/llms.txt`;
}
/**
 * One hop, HTTPS only, same path. Allows the same host or a single apex ↔ www change.
 * Any other redirect is refused.
 */
export function sameSiteRedirect(fromUrl, location) {
    if (!location)
        return null;
    let from;
    let next;
    try {
        from = new URL(fromUrl);
        next = new URL(location, fromUrl);
    }
    catch {
        return null;
    }
    if (next.protocol !== "https:")
        return null;
    if (next.pathname !== from.pathname || next.search !== from.search)
        return null;
    const left = from.hostname.toLowerCase();
    const right = next.hostname.toLowerCase();
    if (left === right)
        return next.toString();
    const apex = (host) => (host.startsWith("www.") ? host.slice(4) : host);
    if (apex(left) === apex(right) && (left === `www.${right}` || right === `www.${left}`)) {
        return next.toString();
    }
    return null;
}
export function assertHttpsEndpoint(endpoint) {
    try {
        const u = new URL(endpoint);
        return u.protocol === "https:";
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=tls.js.map