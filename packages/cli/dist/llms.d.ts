/** Project-relative paths checked, in order, for an existing manifest. */
export declare const LLMS_CANDIDATES: readonly ["llms.txt", ".well-known/llms.txt", "public/llms.txt", "public/.well-known/llms.txt", "static/llms.txt", "static/.well-known/llms.txt", "docs/llms.txt", "src/llms.txt"];
export interface LlmsManifest {
    name?: string;
    description?: string;
    domain?: string;
    services: string[];
    /** Absolute path when loaded from disk. */
    path?: string;
}
export declare function findLlmsFile(cwd: string): Promise<string | undefined>;
export declare function parseLlms(text: string): LlmsManifest;
export declare function readLlms(cwd: string): Promise<LlmsManifest | undefined>;
export declare function renderLlms(input: {
    name: string;
    description: string;
    domain: string;
    services: string[];
}): string;
export declare function parseServiceList(value: string | undefined): string[];
//# sourceMappingURL=llms.d.ts.map