import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryCache } from "../src/cache.js";
import type { VerifyResult } from "../src/types.js";

function result(domain: string): VerifyResult {
  return {
    status: "VERIFIED",
    domain,
    claims: { did: `did:web:${domain}` },
    checkedAt: "2026-09-22T00:00:00.000Z",
  };
}

describe("MemoryCache disk copy", () => {
  it("reloads a public verify result from disk into a new cache", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentic-trust-cache-"));
    const first = new MemoryCache({ diskDirectory: directory, maxEntries: 10 });
    first.set("verify:example.com", result("example.com"), 60_000);

    const second = new MemoryCache({ diskDirectory: directory });
    const hit = second.get("verify:example.com");
    expect(hit).toMatchObject({ status: "VERIFIED", domain: "example.com", cached: true });

    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      const warm = second.get("verify:example.com");
      samples.push(performance.now() - start);
      expect(warm?.cached).toBe(true);
    }
    samples.sort((left, right) => left - right);
    expect(samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY).toBeLessThan(5);

    const files = readdirSync(directory);
    expect(files).toHaveLength(1);
    expect(readFileSync(path.join(directory, files[0] ?? ""), "utf8")).not.toContain("PRIVATE KEY");

    second.clear();
    expect(readdirSync(directory)).toHaveLength(0);
    expect(new MemoryCache({ diskDirectory: directory }).get("verify:example.com")).toBeUndefined();
  });

  it("refuses to store a private key", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentic-trust-cache-"));
    const cache = new MemoryCache({ diskDirectory: directory });
    const secret = {
      ...result("example.com"),
      claims: { note: "-----BEGIN PRIVATE KEY-----\nabc" },
    };
    expect(() => cache.set("verify:example.com", secret, 60_000)).toThrow(/private key/i);
    expect(readdirSync(directory)).toHaveLength(0);
    expect(cache.get("verify:example.com")).toBeUndefined();
  });

  it("ignores a cache directory or file that other users can write", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentic-trust-cache-"));
    new MemoryCache({ diskDirectory: directory }).set("verify:example.com", result("example.com"), 60_000);
    chmodSync(directory, 0o777);
    expect(new MemoryCache({ diskDirectory: directory }).get("verify:example.com")).toBeUndefined();

    chmodSync(directory, 0o700);
    const [file] = readdirSync(directory);
    chmodSync(path.join(directory, file ?? ""), 0o666);
    expect(new MemoryCache({ diskDirectory: directory }).get("verify:example.com")).toBeUndefined();
  });

  it("ignores a planted record that is not a verify result", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agentic-trust-cache-"));
    const key = "verify:planted.example";
    const name = `${createHash("sha256").update(key).digest("hex")}.json`;
    writeFileSync(
      path.join(directory, name),
      JSON.stringify({ key, expiresAt: Date.now() + 60_000, value: { status: "TRUSTED", domain: 1 } }),
      { mode: 0o600 }
    );
    expect(new MemoryCache({ diskDirectory: directory }).get(key)).toBeUndefined();
  });
});
