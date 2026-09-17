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

export function assertHttpsEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}
