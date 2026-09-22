/**
 * Domain / URL helpers and soft TLS-adjacent checks.
 * Full certificate-chain inspection requires Node tls sockets;
 * browser/SDK path relies on HTTPS fetch succeeding + DID key match.
 */
export declare function normalizeDomain(domainUrl: string): string;
export declare function didWebId(domain: string): string;
export declare function wellKnownDidUrl(domain: string): string;
export declare function wellKnownLlmsUrl(domain: string): string;
export declare function assertHttpsEndpoint(endpoint: string): boolean;
//# sourceMappingURL=tls.d.ts.map