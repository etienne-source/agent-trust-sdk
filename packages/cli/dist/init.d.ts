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
    confirm: boolean;
    skipRegister: boolean;
    forceKeys: boolean;
    /** When false, skip `.cursorrules` and `.cursor/rules/agentic-trust.mdc`. Default true. */
    ideRules: boolean;
    fetch: typeof fetch;
    prompt: (question: string) => Promise<string>;
    log: (line?: string) => void;
}
export declare function runInit(options: InitOptions): Promise<number>;
//# sourceMappingURL=init.d.ts.map