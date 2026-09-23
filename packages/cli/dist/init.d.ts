export declare const PRIVATE_KEY_BACKUP_WARNING = "\u26A0\uFE0F Backup your .agentic-trust/private-key.pem! If lost, this domain's identity cannot be recovered or rotated.";
export interface InitOptions {
    cwd: string;
    domain?: string;
    name?: string;
    description?: string;
    services?: string;
    verificationType?: string;
    apiUrl?: string;
    envApiUrl?: string;
    nonInteractive: boolean;
    stdinIsTTY: boolean;
    /** When false, register but do not POST /v1/register/confirm. Default true. */
    autoConfirm: boolean;
    skipRegister: boolean;
    forceKeys: boolean;
    /** When false, skip `.cursorrules` and `.cursor/rules/agentic-trust.mdc`. Default true. */
    ideRules: boolean;
    proofBudgetMs?: number;
    proofIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    fetch: typeof fetch;
    prompt: (question: string) => Promise<string>;
    log: (line?: string) => void;
}
export declare function runInit(options: InitOptions): Promise<number>;
//# sourceMappingURL=init.d.ts.map