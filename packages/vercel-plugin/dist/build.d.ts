export declare const AGENTIC_TRUST_VERCEL_BIN = "agentic-trust-vercel";
export interface AgenticTrustVercelConfig {
    buildCommand?: string;
    [key: string]: unknown;
}
export interface AgenticTrustVercelBuildOptions {
    /** Project root. Defaults to `process.cwd()`. */
    cwd?: string;
    /**
     * Directory that is served as the site root.
     * Defaults to `public` when a Next.js config or `public/` exists, otherwise the project root.
     */
    outDir?: string;
    domain?: string;
    businessName?: string;
    description?: string;
    services?: string;
    /** Ed25519 or P-256 PKCS#8 PEM. Never written to disk. */
    privateKeyPem?: string;
    /**
     * When true, sign and return the public files without writing them.
     * The private key is still required and is still not written.
     */
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
}
export interface AgenticTrustVercelArtifact {
    /** Path relative to the project root. */
    path: string;
    contents: string;
}
export interface AgenticTrustVercelBuildResult {
    domain: string;
    did: string;
    publicKeyHash: string;
    algorithm: "Ed25519" | "ES256";
    dryRun: boolean;
    llmsGenerated: boolean;
    files: AgenticTrustVercelArtifact[];
    written: string[];
}
export declare function agenticTrustBuildCommand(appBuild?: string): string;
/**
 * Merge a `vercel.json` object so the build signs identity files before the app build.
 * The private key is not part of this object. Set it as a Vercel environment secret.
 */
export declare function withAgenticTrustVercelConfig<T extends AgenticTrustVercelConfig>(config: T, appBuild?: string): T & {
    buildCommand: string;
};
/**
 * Sign `llms.txt` and `.well-known/did.json` for a Vercel or Next.js build.
 * Reads `AGENTIC_TRUST_PRIVATE_KEY` from the environment. The key is not written.
 */
export declare function runAgenticTrustVercelBuild(options?: AgenticTrustVercelBuildOptions): Promise<AgenticTrustVercelBuildResult>;
//# sourceMappingURL=build.d.ts.map