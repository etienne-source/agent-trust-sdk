import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { importPublicKey, verifyDidJws, type DidDocument } from "@trustflow/sdk";
import { main } from "../src/cli.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-init-"));
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

describe("trustflow init", () => {
  it("prints help", async () => {
    const { lines, log } = capture();
    const code = await main(["--help"], { log, stdinIsTTY: false });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("trustflow init");
    expect(text).toContain("sign-llms");
    expect(text).toContain("npx @trustflow/cli@latest init");
    expect(text).toContain("Trustflow CLI");
    expect(text).toContain("agentic-trust is a deprecated alias");
    expect(text).not.toContain("AgenticTrust");
    expect(text).toContain("https://api.trustflow.systems/v1/register");
    expect(text).toContain("SSL_CHALLENGE");
    expect(text).not.toMatch(/npm install trustflow-sdk/);
  });

  it("scaffolds llms.txt, a gitignored key, and a signed did.json without calling the API", async () => {
    const cwd = await tempProject();
    const { lines, log } = capture();
    const fetch = vi.fn();
    const code = await main(
      [
        "init",
        "--non-interactive",
        "--skip-register",
        "--domain",
        "example.com",
        "--name",
        "Example Co",
        "--description",
        "Widgets",
        "--services",
        "Search, Docs",
      ],
      { cwd, log, fetch: fetch as unknown as typeof globalThis.fetch, stdinIsTTY: false }
    );
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    const output = lines.join("\n");
    expect(output).toContain("Verified Domain Context | Trustflow");
    expect(output).toContain("https://trustflow.systems/verify/example.com");
    expect(output).toContain(
      "⚠️ Backup your .agentic-trust/private-key.pem! If lost, this domain's identity cannot be recovered or rotated."
    );
    expect(output).not.toContain("PRIVATE KEY");

    const llms = await readFile(path.join(cwd, "llms.txt"), "utf8");
    expect(llms).toContain("# Example Co");
    expect(llms).toContain("- Search");
    const did = JSON.parse(
      await readFile(path.join(cwd, ".well-known", "did.json"), "utf8")
    ) as DidDocument;
    expect(did.id).toBe("did:web:example.com");
    const key = await importPublicKey(did);
    expect((await verifyDidJws(did, key!)).ok).toBe(true);

    const gitignore = await readFile(path.join(cwd, ".gitignore"), "utf8");
    expect(gitignore).toContain(".agentic-trust/");
    const privateKey = await readFile(path.join(cwd, ".agentic-trust", "private-key.pem"), "utf8");
    expect(privateKey).toContain("PRIVATE KEY");
    const mode = (await stat(path.join(cwd, ".agentic-trust", "private-key.pem"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(JSON.stringify(did)).not.toContain("PRIVATE KEY");
  });

  it("keeps an existing llms.txt and posts SSL_CHALLENGE to the live register route", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "public"));
    const original = "# Kept Name\n> Kept description\n\nDomain: kept.example\n\n## Services\n- Billing\n";
    await writeFile(path.join(cwd, "public", "llms.txt"), original, "utf8");

    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/.well-known/did.json")) {
        const body = await readFile(path.join(cwd, "public", ".well-known", "did.json"), "utf8");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (method === "GET" && url.includes("agentic-trust-challenge.txt")) {
        return new Response("token-from-api", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      if (url.endsWith("/v1/register/confirm")) {
        return jsonResponse({ status: "VERIFIED", domain: body.domain });
      }
      return jsonResponse({
        domain: "kept.example",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "token-from-api",
        challengePath: "https://kept.example/.well-known/agentic-trust-challenge.txt",
        instructions:
          "Serve the challenge token as the exact body of GET https://kept.example/.well-known/agentic-trust-challenge.txt, then POST /v1/register/confirm.",
        expiresAt: "2026-09-23T00:00:00.000Z",
        tier: "free",
      });
    });

    const { lines, log } = capture();
    const code = await main(
      [
        "init",
        "--non-interactive",
        "--confirm",
        "--api-url",
        "https://trustflow.systems/api/register",
      ],
      { cwd, log, fetch: fetch as unknown as typeof globalThis.fetch, stdinIsTTY: false }
    );
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, "public", "llms.txt"), "utf8")).toBe(original);
    expect(calls[0]?.url).toBe("https://api.trustflow.systems/v1/register");
    expect(calls[0]?.body).toMatchObject({
      domain: "kept.example",
      businessName: "Kept Name",
      verificationType: "SSL_CHALLENGE",
      services: ["Billing"],
    });
    expect(calls[1]?.url).toBe("https://api.trustflow.systems/v1/register/confirm");
    expect(calls[1]?.body).toMatchObject({
      domain: "kept.example",
      challengeToken: "token-from-api",
    });
    const challenge = await readFile(
      path.join(cwd, "public", ".well-known", "agentic-trust-challenge.txt"),
      "utf8"
    );
    expect(challenge).toBe("token-from-api");
    await expect(readFile(path.join(cwd, ".well-known", "agentic-trust-challenge.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, "llms.txt"), "utf8")).rejects.toThrow();
    const output = lines.join("\n");
    expect(output).toContain("Verified Domain Context | Trustflow");
    expect(output).toContain("https://trustflow.systems/verify/kept.example");
    expect(output).toContain("Registration confirmed.");
  });

  it("confirms from the saved registration file", async () => {
    const cwd = await tempProject();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/.well-known/did.json")) {
        const body = await readFile(path.join(cwd, ".well-known", "did.json"), "utf8");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (method === "GET" && url.includes("agentic-trust-challenge.txt")) {
        return new Response("saved-token", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      if (url.endsWith("/v1/register/confirm")) {
        return jsonResponse({ status: "VERIFIED", domain: "example.com" });
      }
      return jsonResponse({
        domain: "example.com",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "saved-token",
        challengePath: "https://example.com/.well-known/agentic-trust-challenge.txt",
        instructions: "Serve the challenge token, then POST /v1/register/confirm.",
        expiresAt: "2026-09-23T00:00:00.000Z",
        tier: "free",
      });
    });
    const first = capture();
    expect(
      await main(
        ["init", "--non-interactive", "--domain", "example.com", "--name", "Example", "--description", "Desc"],
        { cwd, log: first.log, fetch: fetchImpl as unknown as typeof globalThis.fetch, stdinIsTTY: false }
      )
    ).toBe(0);

    const confirmFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.trustflow.systems/v1/register/confirm");
      expect(JSON.parse(String(init?.body)).challengeToken).toBe("saved-token");
      return jsonResponse({ status: "VERIFIED", domain: "example.com" });
    });
    const second = capture();
    const code = await main(["confirm"], {
      cwd,
      log: second.log,
      fetch: confirmFetch as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
    });
    expect(code).toBe(0);
    expect(second.lines.join("\n")).toContain("https://trustflow.systems/verify/example.com");
  });

  it("fails closed when non-interactive init is missing a site name", async () => {
    const cwd = await tempProject();
    const code = await main(["init", "--non-interactive", "--skip-register", "--domain", "example.com"], {
      cwd,
      log: () => undefined,
      stdinIsTTY: false,
    });
    expect(code).toBe(1);
  });
});
