/**
 * Remove private-key material from a log line. Challenge tokens and other
 * tracked secrets are removed by exact match. The function never returns the
 * original secret substrings when they are long enough to be distinctive.
 */
export declare function redactSecrets(text: string, secrets: readonly string[]): string;
/** Ask GitHub Actions to mask each non-empty line. No-op outside Actions. */
export declare function maskForGitHubActions(value: string | undefined): void;
//# sourceMappingURL=redact.d.ts.map