import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { detectProjectLayout, nuxtMajor, parseNuxtPublicDir, parseVitePublicDir } from "../src/framework.js";
import {
  DEFAULT_PROOF_BUDGET_MS,
  DEFAULT_PROOF_INTERVAL_MS,
  autoConfirm,
  probeLiveProofs,
} from "../src/proofs.js";
import type { VerificationType } from "../src/api.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-zero-"));
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line?: string) => lines.push(line ?? "") };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PEM = "-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----\n";
const OTHER_PEM = "-----BEGIN PUBLIC KEY-----\nOTHER\n-----END PUBLIC KEY-----\n";

function didBody(pem: string, id = "did:web:example.com"): string {
  return JSON.stringify({
    id,
    verificationMethod: [{ id: `${id}#key-1`, type: "JsonWebKey2020", controller: id, publicKeyPem: pem }],
  });
}

describe("framework detection", () => {
  it("reads Vite publicDir and Nuxt dir.public without executing config", () => {
    expect(parseVitePublicDir('export default { publicDir: "webroot" }')).toBe("webroot");
    expect(parseVitePublicDir("export default { publicDir: false }")).toBe(false);
    expect(parseVitePublicDir("export default { publicDir: './public' }")).toBe("public");
    expect(parseVitePublicDir("// publicDir: \"nope\"\nexport default { publicDir: 'ok' }")).toBe("ok");
    expect(parseVitePublicDir("export default {}")).toBeUndefined();
    expect(parseNuxtPublicDir("export default { dir: { public: 'html' } }")).toBe("html");
    expect(parseNuxtPublicDir("export default { dir: { static: 'assets' } }")).toBe("assets");
    expect(parseNuxtPublicDir("export default { dir: { public: '../secrets' } }")).toBeUndefined();
    expect(nuxtMajor("^2.17.3")).toBe(2);
    expect(nuxtMajor("3.12.0")).toBe(3);
  });

  it("places Next.js, Vite, and Nuxt on their public directories", async () => {
    const nextDir = await tempProject();
    await writeFile(path.join(nextDir, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }), "utf8");
    await mkdir(path.join(nextDir, "static"));
    expect(await detectProjectLayout(nextDir)).toMatchObject({ framework: "next", publicDir: "public" });

    const viteDir = await tempProject();
    await writeFile(path.join(viteDir, "package.json"), JSON.stringify({ devDependencies: { vite: "^6.0.0" } }), "utf8");
    await writeFile(path.join(viteDir, "vite.config.ts"), "export default { publicDir: 'webroot' }\n", "utf8");
    await mkdir(path.join(viteDir, "public"));
    expect(await detectProjectLayout(viteDir)).toMatchObject({
      framework: "vite",
      publicDir: "webroot",
    });

    const viteDefault = await tempProject();
    await writeFile(path.join(viteDefault, "vite.config.ts"), "export default {}\n", "utf8");
    expect(await detectProjectLayout(viteDefault)).toMatchObject({ framework: "vite", publicDir: "public" });

    const nuxt2 = await tempProject();
    await writeFile(path.join(nuxt2, "package.json"), JSON.stringify({ dependencies: { nuxt: "^2.17.3" } }), "utf8");
    expect(await detectProjectLayout(nuxt2)).toMatchObject({ framework: "nuxt", publicDir: "static" });

    const nuxt3 = await tempProject();
    await writeFile(
      path.join(nuxt3, "nuxt.config.ts"),
      "export default defineNuxtConfig({ dir: { public: 'html' } })\n",
      "utf8"
    );
    await writeFile(path.join(nuxt3, "package.json"), JSON.stringify({ dependencies: { nuxt: "3.13.0" } }), "utf8");
    expect(await detectProjectLayout(nuxt3)).toMatchObject({ framework: "nuxt", publicDir: "html" });

    const plain = await tempProject();
    await mkdir(path.join(plain, "static"));
    expect(await detectProjectLayout(plain)).toMatchObject({ framework: "unknown", publicDir: "static" });
  });
});

describe("zero-config init writes", () => {
  const args = [
    "init",
    "--non-interactive",
    "--skip-register",
    "--domain",
    "example.com",
    "--name",
    "Example Co",
    "--description",
    "Widgets",
  ];

  it("writes Next.js public files and IDE rules with no path flag", async () => {
    const cwd = await tempProject();
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }), "utf8");
    const { lines, log } = capture();
    const code = await main(args, { cwd, log, stdinIsTTY: false });
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain("Next.js");
    expect(output).toContain("public/");
    const did = JSON.parse(await readFile(path.join(cwd, "public", ".well-known", "did.json"), "utf8")) as { id: string };
    expect(did.id).toBe("did:web:example.com");
    const llms = await readFile(path.join(cwd, "public", "llms.txt"), "utf8");
    expect(llms).toContain("# Example Co");
    expect(await readFile(path.join(cwd, "public", ".well-known", "llms.txt"), "utf8")).toBe(llms);
    await expect(readFile(path.join(cwd, ".well-known", "did.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, "llms.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, ".well-known", "llms.txt"), "utf8")).rejects.toThrow();
    expect(output).toContain("middleware.ts");
    expect(output).toContain("/.well-known/");
    expect(output).toContain("/llms.txt");
    expect(output).toContain(
      "⚠️ Backup your .agentic-trust/private-key.pem! If lost, this domain's identity cannot be recovered or rotated."
    );
    const rules = await readFile(path.join(cwd, ".cursorrules"), "utf8");
    expect(rules).toContain("public/.well-known/did.json");
    expect(rules).toContain("public/llms.txt");
    const mdc = await readFile(path.join(cwd, ".cursor", "rules", "agentic-trust.mdc"), "utf8");
    expect(mdc).toContain("public/.well-known/did.json");
  });

  it("writes only under public/ when that folder already exists", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "public"));
    const { lines, log } = capture();
    const code = await main(args, { cwd, log, stdinIsTTY: false });
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, "public", "llms.txt"), "utf8")).toContain("# Example Co");
    expect(await readFile(path.join(cwd, "public", ".well-known", "did.json"), "utf8")).toContain("did:web:example.com");
    expect(await readFile(path.join(cwd, "public", ".well-known", "llms.txt"), "utf8")).toContain("# Example Co");
    await expect(readFile(path.join(cwd, "llms.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, ".well-known", "did.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, ".well-known", "llms.txt"), "utf8")).rejects.toThrow();
    expect(lines.join("\n")).toContain(
      "⚠️ Backup your .agentic-trust/private-key.pem! If lost, this domain's identity cannot be recovered or rotated."
    );
  });

  it("writes Vite publicDir and Nuxt 2 static files", async () => {
    const vite = await tempProject();
    await writeFile(path.join(vite, "vite.config.ts"), "export default { publicDir: 'webroot' }\n", "utf8");
    expect(await main(args, { cwd: vite, log: () => undefined, stdinIsTTY: false })).toBe(0);
    expect(await readFile(path.join(vite, "webroot", "llms.txt"), "utf8")).toContain("Domain: example.com");
    expect(await readFile(path.join(vite, "webroot", ".well-known", "did.json"), "utf8")).toContain("did:web:example.com");
    expect(await readFile(path.join(vite, "webroot", ".well-known", "llms.txt"), "utf8")).toContain("# Example Co");
    await expect(readFile(path.join(vite, "llms.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(vite, ".well-known", "did.json"), "utf8")).rejects.toThrow();
    const rules = await readFile(path.join(vite, ".cursorrules"), "utf8");
    expect(rules).toContain("webroot/.well-known/did.json");

    const nuxt = await tempProject();
    await writeFile(path.join(nuxt, "package.json"), JSON.stringify({ dependencies: { nuxt: "^2.17.3" } }), "utf8");
    expect(await main(args, { cwd: nuxt, log: () => undefined, stdinIsTTY: false })).toBe(0);
    expect(await readFile(path.join(nuxt, "static", ".well-known", "did.json"), "utf8")).toContain("did:web:example.com");
    expect(await readFile(path.join(nuxt, "static", "llms.txt"), "utf8")).toContain("# Example Co");
    await expect(readFile(path.join(nuxt, "llms.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(nuxt, ".well-known", "did.json"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(nuxt, ".cursor", "rules", "agentic-trust.mdc"), "utf8")).toContain(
      "static/.well-known/did.json"
    );
  });
});

describe("auto-confirm", () => {
  it("keeps the proof loop under 10 seconds", () => {
    expect(DEFAULT_PROOF_INTERVAL_MS).toBeLessThanOrEqual(250);
    expect(DEFAULT_PROOF_BUDGET_MS).toBeLessThanOrEqual(8_000);
    expect(DEFAULT_PROOF_BUDGET_MS).toBeLessThan(10_000);
  });

  it("probes the DID and the challenge in parallel", async () => {
    let inflight = 0;
    let maxInflight = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await gate;
      inflight -= 1;
      const url = String(input);
      if (url.endsWith("/did.json")) {
        return new Response(didBody(PEM), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("token-1", { status: 200 });
    });
    const pending = probeLiveProofs({
      fetchFn: fetch as unknown as typeof fetch,
      domain: "example.com",
      didId: "did:web:example.com",
      publicKeyPem: PEM,
      verificationType: "SSL_CHALLENGE",
      challengeToken: "token-1",
    });
    await vi.waitFor(() => expect(maxInflight).toBeGreaterThanOrEqual(2));
    release();
    await expect(pending).resolves.toBe("ready");
  });

  it("confirms only after proofs are reachable, with short sleeps", async () => {
    let now = 0;
    const sleeps: number[] = [];
    let ready = false;
    const calls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/register/confirm")) {
        return jsonResponse({ status: "VERIFIED", domain: "example.com" });
      }
      if (!ready) return new Response("missing", { status: 404 });
      if (url.endsWith("/did.json")) {
        return new Response(didBody(PEM), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("token-1", { status: 200 });
    });
    const result = await autoConfirm({
      apiBase: "https://api.trustflow.systems",
      fetchFn: fetch as unknown as typeof fetch,
      domain: "example.com",
      didId: "did:web:example.com",
      publicKeyPem: PEM,
      publicKeyHash: "hash",
      verificationType: "SSL_CHALLENGE" satisfies VerificationType,
      challengeToken: "token-1",
      businessName: "Example",
      services: ["Docs"],
      budgetMs: 8_000,
      intervalMs: 200,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
        ready = true;
      },
      log: () => undefined,
    });
    expect(result).toMatchObject({ code: 0, verified: true });
    expect(sleeps).toEqual([200]);
    expect(now).toBeLessThan(10_000);
    const confirm = calls.filter((call) => call.includes("/v1/register/confirm"));
    expect(confirm).toHaveLength(1);
    expect(calls[0]).not.toContain("/v1/register/confirm");
  });

  it("does not confirm when the live key does not match", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(didBody(OTHER_PEM), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { lines, log } = capture();
    const result = await autoConfirm({
      apiBase: "https://api.trustflow.systems",
      fetchFn: fetch as unknown as typeof fetch,
      domain: "example.com",
      didId: "did:web:example.com",
      publicKeyPem: PEM,
      publicKeyHash: "hash",
      verificationType: "SSL_CHALLENGE",
      challengeToken: "token-1",
      budgetMs: 8_000,
      intervalMs: 200,
      now: () => 0,
      sleep: async () => {
        throw new Error("mismatch must not wait");
      },
      log,
    });
    expect(result.code).toBe(1);
    expect(result.verified).toBe(false);
    expect(calls.some((call) => call.includes("/confirm"))).toBe(false);
    expect(lines.join("\n")).toContain("public key does not match");
  });

  it("stops inside the budget when proofs never appear", async () => {
    let now = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        throw new Error("confirm must wait for a live proof");
      }
      return new Response("nope", { status: 404 });
    });
    const { lines, log } = capture();
    const result = await autoConfirm({
      apiBase: "https://api.trustflow.systems",
      fetchFn: fetch as unknown as typeof fetch,
      domain: "example.com",
      didId: "did:web:example.com",
      publicKeyPem: PEM,
      publicKeyHash: "hash",
      verificationType: "SSL_CHALLENGE",
      challengeToken: "token-1",
      budgetMs: 400,
      intervalMs: 200,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      log,
    });
    expect(result.code).toBe(1);
    expect(now).toBe(400);
    expect(now).toBeLessThan(10_000);
    expect(lines.join("\n")).toContain("No live proof was observed");
  });

  it("confirms DNS_TXT from the TXT record and the DID key", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/confirm")) return jsonResponse({ status: "VERIFIED", domain: "example.com" });
      return new Response(didBody(PEM), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const result = await autoConfirm({
      apiBase: "https://api.trustflow.systems",
      fetchFn: fetch as unknown as typeof fetch,
      domain: "example.com",
      didId: "did:web:example.com",
      publicKeyPem: PEM,
      publicKeyHash: "hash",
      verificationType: "DNS_TXT",
      challengeToken: "token-1",
      dnsRecord: { name: "_agentic-trust.example.com", value: "agentic-trust-verification=token-1" },
      resolveTxt: async () => [["agentic-trust-verification=token-1"]],
      budgetMs: 1_000,
      intervalMs: 200,
      now: () => 0,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(result.verified).toBe(true);
    expect(calls.some((url) => url.includes("agentic-trust-challenge.txt"))).toBe(false);
    expect(calls.some((url) => url.endsWith("/confirm"))).toBe(true);
  });

  it("auto-confirms init once HTTPS proofs match and prints the verify URL", async () => {
    const cwd = await tempProject();
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }), "utf8");
    const calls: string[] = [];
    const started = Date.now();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${url}`);
      if (method === "GET" && url.includes("/.well-known/did.json")) {
        const body = await readFile(path.join(cwd, "public", ".well-known", "did.json"), "utf8");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (method === "GET" && url.includes("agentic-trust-challenge.txt")) {
        return new Response("live-token", { status: 200 });
      }
      if (url.endsWith("/v1/register/confirm")) {
        const body = JSON.parse(String(init?.body)) as { challengeToken?: string; publicKeyHash?: string; did?: string };
        expect(body.challengeToken).toBe("live-token");
        expect(body.did).toBe("did:web:example.com");
        expect(body.publicKeyHash).toBeTruthy();
        return jsonResponse({ status: "VERIFIED", domain: "example.com" });
      }
      const body = JSON.parse(String(init?.body)) as { publicKeyPem?: string };
      expect(body.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      return jsonResponse({
        domain: "example.com",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "live-token",
        challengePath: "https://example.com/.well-known/agentic-trust-challenge.txt",
        instructions: "Paste live-token into a browser. This text must not be required.",
        expiresAt: "2026-09-23T00:00:00.000Z",
      });
    });
    const { lines, log } = capture();
    const code = await main(
      ["init", "--non-interactive", "--domain", "example.com", "--name", "Example Co", "--description", "Widgets"],
      { cwd, log, fetch: fetch as unknown as typeof fetch, stdinIsTTY: false }
    );
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await readFile(path.join(cwd, "public", ".well-known", "agentic-trust-challenge.txt"), "utf8")).toBe("live-token");
    const output = lines.join("\n");
    expect(output).toContain("Registration confirmed.");
    expect(output).toContain("https://trustflow.systems/verify/example.com");
    expect(output).toContain("Verified by AgenticTrust | trustflow.systems");
    expect(output).not.toContain("live-token");
    expect(output).not.toContain("Paste live-token");
    expect(calls.filter((call) => call.startsWith("POST") && call.includes("/v1/register/confirm"))).toHaveLength(1);
    expect(calls.some((call) => call.startsWith("POST") && call.includes("/v1/register") && !call.includes("/confirm"))).toBe(
      true
    );
  });

  it("skips confirm when --no-auto-confirm is set", async () => {
    const cwd = await tempProject();
    const calls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return jsonResponse({
        domain: "example.com",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "held-token",
        challengePath: "https://example.com/.well-known/agentic-trust-challenge.txt",
        instructions: "ignored",
        expiresAt: "2026-09-23T00:00:00.000Z",
      });
    });
    const { lines, log } = capture();
    const code = await main(
      [
        "init",
        "--non-interactive",
        "--no-auto-confirm",
        "--domain",
        "example.com",
        "--name",
        "Example Co",
        "--description",
        "Widgets",
      ],
      { cwd, log, fetch: fetch as unknown as typeof fetch, stdinIsTTY: false }
    );
    expect(code).toBe(0);
    expect(calls.some((call) => call.includes("/confirm"))).toBe(false);
    expect(lines.join("\n")).toContain("Skipped auto-confirm");
    expect(await readFile(path.join(cwd, "public", ".well-known", "agentic-trust-challenge.txt"), "utf8")).toBe("held-token");
  });
});
