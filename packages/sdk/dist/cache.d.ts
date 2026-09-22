import type { VerifyResult } from "./types.js";
export interface MemoryCacheOptions {
    /** Maximum in-memory entries. Default 1000. */
    maxEntries?: number;
    /**
     * Optional directory for a JSON result cache.
     * Only verification results are stored. Private keys are refused.
     * A warm in-memory hit does not read this directory.
     */
    diskDirectory?: string;
}
/**
 * In-memory result cache for `verifyDomain` and middleware lookups.
 * A warm hit stays in memory and is the sub-5ms path.
 * `diskDirectory` is an optional cold-start copy of those same public results.
 */
export declare class MemoryCache {
    private store;
    private maxEntries;
    private diskDirectory?;
    constructor(maxEntriesOrOptions?: number | MemoryCacheOptions);
    get(key: string): VerifyResult | undefined;
    set(key: string, value: VerifyResult, ttlMs: number): void;
    clear(): void;
    private readMemory;
    private remember;
}
export declare const defaultCache: MemoryCache;
//# sourceMappingURL=cache.d.ts.map