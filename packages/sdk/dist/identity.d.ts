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
    /**
     * Ed25519 or P-256 private key PEM (PKCS#8). When set, the matching SPKI public
     * key is derived unless `publicKeyPem` is also provided.
     */
    privateKeyPem?: string;
    publicKeyPem?: string;
    /** SHA-256 hex from {@link hashLlmsTxt}. Included in the signed payload when set. */
    llmsTxtSha256?: string;
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
 * SHA-256 hex of an llms.txt body. A leading BOM and CRLF are normalized, and
 * one trailing newline is ignored, so the file on disk and the HTTP body match.
 */
export declare function hashLlmsTxt(text: string): string;
/**
 * Derive the SPKI public key and a PKCS#8 copy from an Ed25519 or P-256 private key PEM.
 * Callers that only have `AGENTIC_TRUST_PRIVATE_KEY` use this path.
 */
export declare function publicKeyPemFromPrivate(privateKeyPem: string): string;
/**
 * Create a did:web document and compact JWS (Ed25519 or ES256) that `verifyDidJws` accepts.
 * Generated keys are Ed25519. The private key is returned to the caller; this function
 * does not write files and does not log key material.
 */
export declare function createSignedDidDocument(input: CreateSignedDidInput): Promise<SignedDidIdentity>;
//# sourceMappingURL=identity.d.ts.map