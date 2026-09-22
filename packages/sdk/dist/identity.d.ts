import type { DidDocument } from "./types.js";
export interface DidServiceEndpoint {
    id: string;
    type: string;
    serviceEndpoint: string;
}
export interface CreateSignedDidInput {
    /** Hostname or URL. Normalized to a lowercase hostname. */
    domain: string;
    services?: DidServiceEndpoint[];
    /** PKCS#8 PEM. When set, `publicKeyPem` is required and no new key is generated. */
    privateKeyPem?: string;
    publicKeyPem?: string;
}
export interface SignedDidIdentity {
    domain: string;
    did: DidDocument;
    publicKeyPem: string;
    privateKeyPem: string;
    /** SHA-256 hex of the normalized SPKI PEM. This is the registry `publicKeyHash`. */
    publicKeyHash: string;
}
/**
 * SHA-256 (hex) of an SPKI PEM, matching the Trustflow registry `publicKeyHash`
 * (CRLF stripped, trimmed, then hashed).
 */
export declare function hashPublicKeyPem(pem: string): string;
/**
 * Create a did:web document and compact JWS (RS256) that `verifyDidJws` accepts.
 * The private key is returned to the caller; this function does not write files.
 */
export declare function createSignedDidDocument(input: CreateSignedDidInput): Promise<SignedDidIdentity>;
//# sourceMappingURL=identity.d.ts.map