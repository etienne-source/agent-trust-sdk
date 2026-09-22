/** In-memory LRU-ish cache for sub-50ms verify hits */
export class MemoryCache {
    store = new Map();
    maxEntries;
    constructor(maxEntries = 1000) {
        this.maxEntries = maxEntries;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        // refresh insertion order for simple LRU
        this.store.delete(key);
        this.store.set(key, entry);
        return { ...entry.value, cached: true };
    }
    set(key, value, ttlMs) {
        if (this.store.size >= this.maxEntries) {
            const first = this.store.keys().next().value;
            if (first !== undefined)
                this.store.delete(first);
        }
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    clear() {
        this.store.clear();
    }
}
export const defaultCache = new MemoryCache();
//# sourceMappingURL=cache.js.map