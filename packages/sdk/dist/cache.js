import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const DISK_FILE = /^[a-f0-9]{64}\.json$/;
function cacheOptions(input) {
    if (typeof input === "number")
        return { maxEntries: input };
    const maxEntries = input?.maxEntries ?? 1000;
    const raw = input?.diskDirectory?.trim();
    return {
        maxEntries,
        diskDirectory: raw ? path.resolve(raw) : undefined,
    };
}
function assertPublicResult(value) {
    const serialized = JSON.stringify(value);
    if (serialized.includes("PRIVATE KEY") ||
        serialized.includes("privateKeyPem") ||
        serialized.includes("BEGIN OPENSSH PRIVATE KEY")) {
        throw new Error("Refusing to cache a verification result that contains a private key");
    }
}
function diskName(key) {
    return `${createHash("sha256").update(key).digest("hex")}.json`;
}
function diskPath(directory, key) {
    const file = path.resolve(directory, diskName(key));
    if (file !== directory && !file.startsWith(directory + path.sep)) {
        throw new Error("Refusing to resolve a cache file outside the cache directory");
    }
    return file;
}
function readDisk(directory, key) {
    const file = diskPath(directory, key);
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return undefined;
    const record = parsed;
    if (record.key !== key || typeof record.expiresAt !== "number" || !record.value)
        return undefined;
    if (Date.now() > record.expiresAt) {
        try {
            fs.unlinkSync(file);
        }
        catch {
            // expired entry is already unusable
        }
        return undefined;
    }
    return { value: record.value, expiresAt: record.expiresAt };
}
function writeDisk(directory, key, entry) {
    const serialized = JSON.stringify({
        key,
        expiresAt: entry.expiresAt,
        value: entry.value,
    });
    if (serialized.includes("PRIVATE KEY") || serialized.includes("privateKeyPem")) {
        throw new Error("Refusing to write a private key to the verify cache");
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = diskPath(directory, key);
    fs.writeFileSync(file, serialized, { encoding: "utf8", mode: 0o600 });
}
/**
 * In-memory result cache for `verifyDomain` and middleware lookups.
 * A warm hit stays in memory and is the sub-5ms path.
 * `diskDirectory` is an optional cold-start copy of those same public results.
 */
export class MemoryCache {
    store = new Map();
    maxEntries;
    diskDirectory;
    constructor(maxEntriesOrOptions = 1000) {
        const options = cacheOptions(maxEntriesOrOptions);
        this.maxEntries = options.maxEntries;
        this.diskDirectory = options.diskDirectory;
    }
    get(key) {
        const memory = this.readMemory(key);
        if (memory)
            return memory;
        if (!this.diskDirectory)
            return undefined;
        const disk = readDisk(this.diskDirectory, key);
        if (!disk)
            return undefined;
        this.remember(key, disk);
        return { ...disk.value, cached: true };
    }
    set(key, value, ttlMs) {
        assertPublicResult(value);
        const entry = { value, expiresAt: Date.now() + ttlMs };
        this.remember(key, entry);
        if (this.diskDirectory)
            writeDisk(this.diskDirectory, key, entry);
    }
    clear() {
        this.store.clear();
        if (!this.diskDirectory)
            return;
        let names = [];
        try {
            names = fs.readdirSync(this.diskDirectory);
        }
        catch {
            return;
        }
        for (const name of names) {
            if (!DISK_FILE.test(name))
                continue;
            try {
                fs.unlinkSync(path.join(this.diskDirectory, name));
            }
            catch {
                // a missing file is already cleared
            }
        }
    }
    readMemory(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        this.store.delete(key);
        this.store.set(key, entry);
        return { ...entry.value, cached: true };
    }
    remember(key, entry) {
        if (!this.store.has(key) && this.store.size >= this.maxEntries) {
            const first = this.store.keys().next().value;
            if (first !== undefined)
                this.store.delete(first);
        }
        this.store.set(key, entry);
    }
}
function defaultDiskDirectory() {
    if (typeof process === "undefined")
        return undefined;
    const value = process.env?.AGENTIC_TRUST_CACHE_DIR?.trim();
    return value || undefined;
}
function defaultMaxEntries() {
    if (typeof process === "undefined")
        return 1000;
    const raw = process.env?.CACHE_MAX_ENTRIES?.trim();
    if (!raw)
        return 1000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}
export const defaultCache = new MemoryCache({
    maxEntries: defaultMaxEntries(),
    diskDirectory: defaultDiskDirectory(),
});
//# sourceMappingURL=cache.js.map