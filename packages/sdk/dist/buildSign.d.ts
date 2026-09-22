import { type DidServiceEndpoint } from "./identity.js";
import type { DidDocument } from "./types.js";
export interface SignBuildArtifactsInput {
    domain: string;
    /** Ed25519 or P-256 PKCS#8 PEM. Required. Never written and never logged by this function. */
    privateKeyPem: string;
    services?: DidServiceEndpoint[];
}
export interface SignBuildArtifactsResult {
    domain: string;
    did: DidDocument;
    didJson: string;
    publicKeyPem: string;
    publicKeyHash: string;
    /** JWS `alg` written into the new proof. */
    algorithm: "EdDSA" | "ES256";
}
export interface BuildSignatureFile {
    /** Path relative to the project root. */
    path: string;
    contents: string;
}
export interface RenewBuildSignaturesOptions {
    /** Project root. Defaults to `process.cwd()`. */
    cwd?: string;
    domain?: string;
    /** Ed25519 or P-256 PKCS#8 PEM. Never written. */
    privateKeyPem?: string;
    /**
     * Directory prefix used when `didPath` and `llmsPath` are omitted.
     * `public` when that directory exists, otherwise the project root.
     */
    outDir?: string;
    /** Repo-relative `did.json` path. */
    didPath?: string;
    /** Repo-relative `llms.txt` path. */
    llmsPath?: string;
    /**
     * Second `llms.txt` copy. Pass `false` to skip it.
     * Defaults to `<outDir>/.well-known/llms.txt` when paths are not explicit.
     */
    wellKnownLlmsPath?: string | false;
    businessName?: string;
    description?: string;
    /** Comma-separated service names used only when `llms.txt` is missing. */
    services?: string;
    /**
     * When true (the default), mint a new `did.json` proof with the same key.
     * When false, an existing `did.json` is left in place.
     */
    rotate?: boolean;
    /** Sign and return public files without writing them. */
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
}
export interface RenewBuildSignaturesResult {
    domain: string;
    did: string;
    publicKeyHash: string;
    algorithm: "EdDSA" | "ES256";
    /** True when a previous `did.json` was replaced with a new proof. */
    rotated: boolean;
    dryRun: boolean;
    llmsGenerated: boolean;
    files: BuildSignatureFile[];
    written: string[];
}
/**
 * Sign a `did:web` document for a build hook.
 * Uses `createSignedDidDocument` so Vercel, Netlify, and CI share one signer.
 * The private key is not part of the result.
 */
export declare function signBuildArtifacts(input: SignBuildArtifactsInput): Promise<SignBuildArtifactsResult>;
/**
 * Renew public `did.json` and `llms.txt` during a Vercel or Netlify build.
 * Reads `AGENTIC_TRUST_PRIVATE_KEY` and `AGENTIC_TRUST_DOMAIN` when options omit them.
 * The private key is not written, not returned, and not included in error text.
 */
export declare function renewBuildSignatures(options?: RenewBuildSignaturesOptions): Promise<RenewBuildSignaturesResult>;
//# sourceMappingURL=buildSign.d.ts.map