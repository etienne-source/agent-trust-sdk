import type { VerifyResult } from "./types.js";
/** In-memory LRU-ish cache for sub-50ms verify hits */
export declare class MemoryCache {
    private store;
    private maxEntries;
    constructor(maxEntries?: number);
    get(key: string): VerifyResult | undefined;
    set(key: string, value: VerifyResult, ttlMs: number): void;
    clear(): void;
}
export declare const defaultCache: MemoryCache;
//# sourceMappingURL=cache.d.ts.map