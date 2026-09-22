#!/usr/bin/env node
export declare function main(argv: string[], io?: {
    cwd?: string;
    fetch?: typeof fetch;
    stdinIsTTY?: boolean;
    prompt?: (question: string) => Promise<string>;
    log?: (line?: string) => void;
    env?: NodeJS.ProcessEnv;
}): Promise<number>;
//# sourceMappingURL=cli.d.ts.map