/**
 * Domain / URL helpers and soft TLS-adjacent checks.
 * Full certificate-chain inspection requires Node tls sockets;
 * browser/SDK path relies on HTTPS fetch succeeding + DID key match.
 */

export function normalizeDomain(domainUrl: string): string {
  let input = domainUrl.trim();
  if (!/^https?:\/\//i.test(input)) {
    input = `https://${input}`;
  }
  const url = new URL(input);
  return url.hostname.toLowerCase();
}

export function didWebId(domain: string): string {
  // did:web:example.com  (path segments use :)
  return `did:web:${domain}`;
}

export function wellKnownDidUrl(domain: string): string {
  return `https://${domain}/.well-known/did.json`;
}

export function wellKnownLlmsUrl(domain: string): string {
  return `https://${domain}/.well-known/llms.txt`;
}

export function rootLlmsUrl(domain: string): string {
  return `https://${domain}/llms.txt`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validate a registry base URL. HTTPS is required; plain HTTP is accepted only for
 * loopback hosts (local development). Returns the URL without a trailing slash.
 */
export function secureApiBase(input: string): string {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Trustflow API URL: ${input}`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`Trustflow API URL must use HTTPS: ${input}`);
  }
  return raw.replace(/\/+$/, "");
}

/**
 * One hop, HTTPS only, same path. Allows the same host or a single apex ↔ www change.
 * Any other redirect is refused.
 */
export function sameSiteRedirect(fromUrl: string, location: string | null): string | null {
  if (!location) return null;
  let from: URL;
  let next: URL;
  try {
    from = new URL(fromUrl);
    next = new URL(location, fromUrl);
  } catch {
    return null;
  }
  if (next.protocol !== "https:") return null;
  if (next.pathname !== from.pathname || next.search !== from.search) return null;
  const left = from.hostname.toLowerCase();
  const right = next.hostname.toLowerCase();
  if (left === right) return next.toString();
  const apex = (host: string) => (host.startsWith("www.") ? host.slice(4) : host);
  if (apex(left) === apex(right) && (left === `www.${right}` || right === `www.${left}`)) {
    return next.toString();
  }
  return null;
}

export function assertHttpsEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}
