import { type DidDocument } from "@trustflow/sdk";
export type DidKeyAlgorithm = "Ed25519" | "ES256";
/** Shown next to `privateKeyPem` in every tool result. */
export declare const PRIVATE_KEY_SECRET_WARNING = "SECRET \u2014 Trustflow did:web private key (PKCS#8 PEM). Do not commit, log, paste into a public channel, or publish this value. Publish only did.json. This tool does not write the key unless privateKeyPath is set.";
export interface GenerateDidKeysInput {
    domain: string;
    /** Ed25519 (default) or ES256 (P-256). */
    algorithm?: string;
    /**
     * When set, write the private key PEM to this path (mode 0600).
     * Omitted means the key is returned only and never written.
     */
    privateKeyPath?: string;
}
export interface GenerateDidKeysResult {
    domain: string;
    did: string;
    algorithm: DidKeyAlgorithm;
    /** Pretty-printed did.json for `/.well-known/did.json`. Public material only. */
    didJson: string;
    didDocument: DidDocument;
    publicKeyPem: string;
    publicKeyHash: string;
    /** SECRET. Unencrypted PKCS#8 PEM. */
    privateKeyPem: string;
    secret: {
        label: "SECRET";
        field: "privateKeyPem";
        warning: string;
        writtenTo?: string;
    };
    publish: {
        didJsonPath: ".well-known/did.json";
        didJsonUrl: string;
        llmsTxtUrl: string;
    };
}
export declare function parseDidKeyAlgorithm(value: string | undefined): DidKeyAlgorithm;
/**
 * Generate a did:web key and a signed W3C document.
 * Ed25519 keys come from `@trustflow/sdk` `createSignedDidDocument`.
 * ES256 uses a P-256 PKCS#8 key passed into that same signer — the DID proof is not built here.
 */
export declare function generateDidKeys(input: GenerateDidKeysInput): Promise<GenerateDidKeysResult>;
//# sourceMappingURL=generateDidKeys.d.ts.map