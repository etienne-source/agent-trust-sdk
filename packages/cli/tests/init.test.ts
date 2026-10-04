import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSignedDidDocument, importPublicKey, verifyDidJws, type DidDocument } from "@trustflow/sdk";
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
    expect(text).toContain("There is no unscoped trustflow package");
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
    if (process.platform === "win32") expect(mode & 0o200).toBeTruthy();
    else expect(mode).toBe(0o600);
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
    const confirmBody = calls[1]?.body as { proofJws?: string; proof?: string };
    expect(confirmBody.proof).toBeUndefined();
    expect(typeof confirmBody.proofJws).toBe("string");
    expect(confirmBody.proofJws?.split(".")).toHaveLength(3);
    expect(JSON.stringify(confirmBody)).not.toContain("PRIVATE KEY");
    const challenge = await readFile(
      path.join(cwd, "public", ".well-known", "agentic-trust-challenge.txt"),
      "utf8"
    );
    expect(challenge).toBe("token-from-api");
    await expect(readFile(path.join(cwd, ".well-known", "agentic-trust-challenge.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, "llms.txt"), "utf8")).rejects.toThrow();
    const output = lines.join("\n");
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
      const body = JSON.parse(String(init?.body)) as {
        challengeToken?: string;
        proofJws?: string;
        proof?: string;
      };
      expect(body.challengeToken).toBe("saved-token");
      expect(body.proof).toBeUndefined();
      expect(typeof body.proofJws).toBe("string");
      expect(body.proofJws?.split(".")).toHaveLength(3);
      expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
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

  it("refuses an existing llms.txt that names another domain", async () => {
    const cwd = await tempProject();
    await writeFile(path.join(cwd, "llms.txt"), "# Copied\n> From elsewhere\n\nDomain: other.example\n", "utf8");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await main(["init", "--non-interactive", "--skip-register", "--domain", "mine.example"], {
      cwd,
      log: () => undefined,
      stdinIsTTY: false,
    });
    expect(code).toBe(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/names other\.example, not mine\.example/);
    errors.mockRestore();
    await expect(stat(path.join(cwd, ".well-known", "did.json"))).rejects.toThrow();
  });

  it("does not write the verified badge before the domain is verified", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "app"), { recursive: true });
    const layout = "<html><body><main /></body></html>\n";
    await writeFile(path.join(cwd, "app", "layout.tsx"), layout, "utf8");
    const { lines, log } = capture();
    const code = await main(
      ["init", "--non-interactive", "--skip-register", "--domain", "example.com", "--name", "Ex", "--description", "D"],
      { cwd, log, stdinIsTTY: false }
    );
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, "app", "layout.tsx"), "utf8")).toBe(layout);
    expect(lines.join("\n")).toContain("Badge not written");
  });

  it("writes the badge only when confirm returns a verified status", async () => {
    const cwd = await tempProject();
    const identity = await createSignedDidDocument({ domain: "example.com" });
    await mkdir(path.join(cwd, ".agentic-trust"), { recursive: true });
    await writeFile(path.join(cwd, ".agentic-trust", "private-key.pem"), identity.privateKeyPem, "utf8");
    await writeFile(path.join(cwd, ".agentic-trust", "public-key.pem"), identity.publicKeyPem, "utf8");
    await writeFile(
      path.join(cwd, ".agentic-trust", "registration.json"),
      JSON.stringify({ domain: "example.com", challengeToken: "t", apiBase: "https://api.trustflow.systems" }),
      "utf8"
    );
    await mkdir(path.join(cwd, "app"), { recursive: true });
    const layout = "<html><body><main /></body></html>\n";
    await writeFile(path.join(cwd, "app", "layout.tsx"), layout, "utf8");

    const pending = capture();
    const pendingCode = await main(["confirm"], {
      cwd,
      log: pending.log,
      fetch: (async () => jsonResponse({ status: "PENDING" })) as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
    });
    expect(pendingCode).toBe(1);
    expect(pending.lines.join("\n")).not.toContain("Registration confirmed.");
    expect(await readFile(path.join(cwd, "app", "layout.tsx"), "utf8")).toBe(layout);

    const verified = capture();
    const verifiedCode = await main(["confirm"], {
      cwd,
      log: verified.log,
      fetch: (async () => jsonResponse({ status: "VERIFIED" })) as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
    });
    expect(verifiedCode).toBe(0);
    expect(await readFile(path.join(cwd, "app", "layout.tsx"), "utf8")).toContain("Verified Domain Context | Trustflow");
  });
});
