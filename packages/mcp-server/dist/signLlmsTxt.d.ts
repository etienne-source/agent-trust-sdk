import { type DidDocument } from "@agentic-trust/sdk";
import type { DidKeyAlgorithm } from "./generateDidKeys.js";
export interface SignLlmsTxtInput {
    domain: string;
    /** Unencrypted Ed25519 or P-256 PKCS#8 PEM. Used to sign; never written by this tool. */
    privateKeyPem: string;
    /** llms.txt body. Use this or `llmsTxtPath`. */
    llmsTxt?: string;
    /** UTF-8 file to read when `llmsTxt` is omitted. */
    llmsTxtPath?: string;
    /**
     * When set, write public artifacts only:
     * `llms.txt`, `.well-known/llms.txt`, and `.well-known/did.json`.
     * The private key is not written.
     */
    outputDir?: string;
}
export interface SignLlmsTxtResult {
    domain: string;
    did: string;
    algorithm: DidKeyAlgorithm;
    didJson: string;
    didDocument: DidDocument;
    publicKeyPem: string;
    publicKeyHash: string;
    /** Manifest to publish. Aligned so it names the same did:web as the signed document. */
    llmsTxt: string;
    artifacts: {
        "llms.txt": string;
        ".well-known/llms.txt": string;
        ".well-known/did.json": string;
    };
    guidance: string[];
    /** Absolute paths written when `outputDir` was set. Public files only. */
    written?: string[];
}
/**
 * Sign a domain's llms.txt the way `@agentic-trust/cli` does:
 * `createSignedDidDocument` produces the did:web JWS whose service endpoint is
 * `/.well-known/llms.txt`. The manifest is updated so it names that same DID.
 * The private key is an input only.
 */
export declare function signLlmsTxt(input: SignLlmsTxtInput): Promise<SignLlmsTxtResult>;
/**
 * Keep a caller-supplied llms.txt, and make sure it names this domain's did:web.
 * Existing prose is preserved. Identity lines that point at another DID are rewritten.
 */
export declare function alignLlmsTxt(body: string, domain: string): string;
//# sourceMappingURL=signLlmsTxt.d.ts.map