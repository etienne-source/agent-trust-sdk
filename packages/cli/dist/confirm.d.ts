export interface ConfirmOptions {
    cwd: string;
    domain?: string;
    token?: string;
    apiUrl?: string;
    envApiUrl?: string;
    fetch: typeof fetch;
    log: (line?: string) => void;
    /** When false, the caller prints the badge (init already did). */
    printBadge?: boolean;
}
export declare function runConfirm(options: ConfirmOptions): Promise<number>;
//# sourceMappingURL=confirm.d.ts.map