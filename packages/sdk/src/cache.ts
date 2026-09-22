import type { VerifyResult } from "./types.js";

interface CacheEntry {
  value: VerifyResult;
  expiresAt: number;
}

/** In-memory LRU-ish cache for sub-50ms verify hits */
export class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): VerifyResult | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // refresh insertion order for simple LRU
    this.store.delete(key);
    this.store.set(key, entry);
    return { ...entry.value, cached: true };
  }

  set(key: string, value: VerifyResult, ttlMs: number): void {
    if (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

export const defaultCache = new MemoryCache();
