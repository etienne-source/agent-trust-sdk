import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VerifyResult } from "./types.js";

interface CacheEntry {
  value: VerifyResult;
  expiresAt: number;
}

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

interface DiskRecord {
  key: string;
  expiresAt: number;
  value: VerifyResult;
}

const DISK_FILE = /^[a-f0-9]{64}\.json$/;

function cacheOptions(input: number | MemoryCacheOptions | undefined): {
  maxEntries: number;
  diskDirectory?: string;
} {
  if (typeof input === "number") return { maxEntries: input };
  const maxEntries = input?.maxEntries ?? 1000;
  const raw = input?.diskDirectory?.trim();
  return {
    maxEntries,
    diskDirectory: raw ? path.resolve(raw) : undefined,
  };
}

function assertPublicResult(value: VerifyResult): void {
  const serialized = JSON.stringify(value);
  if (
    serialized.includes("PRIVATE KEY") ||
    serialized.includes("privateKeyPem") ||
    serialized.includes("BEGIN OPENSSH PRIVATE KEY")
  ) {
    throw new Error("Refusing to cache a verification result that contains a private key");
  }
}

function diskName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.json`;
}

function diskPath(directory: string, key: string): string {
  const file = path.resolve(directory, diskName(key));
  if (file !== directory && !file.startsWith(directory + path.sep)) {
    throw new Error("Refusing to resolve a cache file outside the cache directory");
  }
  return file;
}

function readDisk(directory: string, key: string): CacheEntry | undefined {
  const file = diskPath(directory, key);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Partial<DiskRecord>;
  if (record.key !== key || typeof record.expiresAt !== "number" || !record.value) return undefined;
  if (Date.now() > record.expiresAt) {
    try {
      fs.unlinkSync(file);
    } catch {
      // expired entry is already unusable
    }
    return undefined;
  }
  return { value: record.value, expiresAt: record.expiresAt };
}

function writeDisk(directory: string, key: string, entry: CacheEntry): void {
  const serialized = JSON.stringify({
    key,
    expiresAt: entry.expiresAt,
    value: entry.value,
  } satisfies DiskRecord);
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
  private store = new Map<string, CacheEntry>();
  private maxEntries: number;
  private diskDirectory?: string;

  constructor(maxEntriesOrOptions: number | MemoryCacheOptions = 1000) {
    const options = cacheOptions(maxEntriesOrOptions);
    this.maxEntries = options.maxEntries;
    this.diskDirectory = options.diskDirectory;
  }

  get(key: string): VerifyResult | undefined {
    const memory = this.readMemory(key);
    if (memory) return memory;
    if (!this.diskDirectory) return undefined;
    const disk = readDisk(this.diskDirectory, key);
    if (!disk) return undefined;
    this.remember(key, disk);
    return { ...disk.value, cached: true };
  }

  set(key: string, value: VerifyResult, ttlMs: number): void {
    assertPublicResult(value);
    const entry: CacheEntry = { value, expiresAt: Date.now() + ttlMs };
    this.remember(key, entry);
    if (this.diskDirectory) writeDisk(this.diskDirectory, key, entry);
  }

  clear(): void {
    this.store.clear();
    if (!this.diskDirectory) return;
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.diskDirectory);
    } catch {
      return;
    }
    for (const name of names) {
      if (!DISK_FILE.test(name)) continue;
      try {
        fs.unlinkSync(path.join(this.diskDirectory, name));
      } catch {
        // a missing file is already cleared
      }
    }
  }

  private readMemory(key: string): VerifyResult | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return { ...entry.value, cached: true };
  }

  private remember(key: string, entry: CacheEntry): void {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, entry);
  }
}

function defaultDiskDirectory(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const value = process.env?.AGENTIC_TRUST_CACHE_DIR?.trim();
  return value || undefined;
}

function defaultMaxEntries(): number {
  if (typeof process === "undefined") return 1000;
  const raw = process.env?.CACHE_MAX_ENTRIES?.trim();
  if (!raw) return 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

export const defaultCache = new MemoryCache({
  maxEntries: defaultMaxEntries(),
  diskDirectory: defaultDiskDirectory(),
});
