export interface SignOptions {
    cwd: string;
    domain?: string;
    name?: string;
    description?: string;
    services?: string;
    verificationType?: string;
    apiUrl?: string;
    envApiUrl?: string;
    /** Ed25519 or P-256 private key PEM. Never written to logs. */
    privateKeyPem?: string;
    dryRun: boolean;
    confirm: boolean;
    requireLive: boolean;
    fetch: typeof fetch;
    log: (line?: string) => void;
    githubOutput?: string;
    githubSummary?: string;
}
export declare function runGithubSign(options: SignOptions): Promise<number>;
//# sourceMappingURL=sign.d.ts.map