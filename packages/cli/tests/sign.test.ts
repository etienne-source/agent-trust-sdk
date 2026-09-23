import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSignedDidDocument, importPublicKey, verifyDidJws, type DidDocument } from "@trustflow/sdk";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { redactSecrets } from "../src/redact.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-sign-"));
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

describe("redactSecrets", () => {
  it("strips PEM blocks and tracked secret lines", () => {
    const secret = "-----BEGIN PRIVATE KEY-----\nABCDEFghij1234567890\n-----END PRIVATE KEY-----\n";
    const text = `failed ${secret} token=ABCDEFghij1234567890`;
    const redacted = redactSecrets(text, [secret, "ABCDEFghij1234567890"]);
    expect(redacted).not.toContain("ABCDEFghij1234567890");
    expect(redacted).toContain("[redacted-private-key]");
  });
});

describe("trustflow sign", () => {
  it("documents the sign command without printing a private key", async () => {
    const { lines, log } = capture();
    const code = await main(["--help"], { log, stdinIsTTY: false });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("trustflow sign");
    expect(text).toContain("AGENTIC_TRUST_PRIVATE_KEY");
    expect(text).toContain("https://api.trustflow.systems/v1/register");
    expect(text).not.toMatch(/npm install trustflow-sdk/);
  });

  it("writes a root llms.txt template and a verifiable did:web document on dry-run", async () => {
    const cwd = await tempProject();
    const identity = await createSignedDidDocument({ domain: "example.invalid" });
    const { lines, log } = capture();
    const fetch = vi.fn();
    const code = await main(["sign", "--dry-run", "--domain", "example.invalid", "--name", "Example Co"], {
      cwd,
      log,
      fetch: fetch as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
      env: { AGENTIC_TRUST_PRIVATE_KEY: identity.privateKeyPem },
    });
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    const output = lines.join("\n");
    expect(output).toContain("Wrote llms.txt");
    expect(output).toContain("skipped POST https://api.trustflow.systems/v1/register");
    expect(output).toContain(`publicKeyHash: ${identity.publicKeyHash}`);
    expect(output).not.toContain("PRIVATE KEY");
    expect(output).not.toContain(identity.privateKeyPem.split("\n")[1] ?? "missing-line");

    const llms = await readFile(path.join(cwd, "llms.txt"), "utf8");
    expect(llms.startsWith("# Example Co\n")).toBe(true);
    expect(llms).toContain("Domain: example.invalid");
    expect(llms).toContain("Agents should call verifyDomain");
    const did = JSON.parse(await readFile(path.join(cwd, ".well-known", "did.json"), "utf8")) as DidDocument;
    expect(did.id).toBe("did:web:example.invalid");
    const key = await importPublicKey(did);
    expect((await verifyDidJws(did, key!)).ok).toBe(true);
    expect(JSON.stringify(did)).not.toContain("PRIVATE KEY");
  });

  it("keeps an existing root llms.txt and posts the public key to /v1/register", async () => {
    const cwd = await tempProject();
    const original = "# Kept Name\n> Kept description\n\nDomain: kept.example\n\n## Services\n- Billing\n";
    await writeFile(path.join(cwd, "llms.txt"), original, "utf8");
    const identity = await createSignedDidDocument({ domain: "kept.example" });

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith("/v1/register/confirm")) {
        return jsonResponse({
          ok: false,
          error: "Domain proof failed",
          detail: "Challenge file mismatch (HTTP 404)",
        }, 400);
      }
      return jsonResponse({
        domain: "kept.example",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "token-from-api",
        challengePath: "https://kept.example/.well-known/agentic-trust-challenge.txt",
        instructions: "Serve the challenge token, then POST /v1/register/confirm.",
        expiresAt: "2026-09-23T00:00:00.000Z",
        tier: "free",
      });
    });

    const { lines, log } = capture();
    const code = await main(["sign", "--domain", "kept.example"], {
      cwd,
      log,
      fetch: fetch as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
      env: {
        AGENTIC_TRUST_PRIVATE_KEY: identity.privateKeyPem,
        AGENTIC_TRUST_DRY_RUN: "false",
        AGENTIC_TRUST_CONFIRM: "true",
      },
    });
    expect(code).toBe(0);
    expect(await readFile(path.join(cwd, "llms.txt"), "utf8")).toBe(original);
    expect(calls[0]?.url).toBe("https://api.trustflow.systems/v1/register");
    expect(calls[0]?.body).toMatchObject({
      domain: "kept.example",
      businessName: "Kept Name",
      verificationType: "SSL_CHALLENGE",
      did: "did:web:kept.example",
      services: ["Billing"],
      manifestUrl: "https://kept.example/.well-known/did.json",
    });
    expect(calls[0]?.body.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("PRIVATE KEY");
    expect(calls[1]?.url).toBe("https://api.trustflow.systems/v1/register/confirm");
    const challenge = await readFile(path.join(cwd, ".well-known", "agentic-trust-challenge.txt"), "utf8");
    expect(challenge).toBe("token-from-api");
    const output = lines.join("\n");
    expect(output).toContain("POST https://api.trustflow.systems/v1/register");
    expect(output).toContain("Confirm is waiting");
    expect(output).not.toContain("token-from-api");
    expect(output).not.toContain("PRIVATE KEY");
  });

  it("fails when a live run has a domain but no private key", async () => {
    const cwd = await tempProject();
    const { lines, log } = capture();
    const code = await main(["sign", "--domain", "example.com"], {
      cwd,
      log,
      stdinIsTTY: false,
      env: { AGENTIC_TRUST_DRY_RUN: "false" },
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("AGENTIC_TRUST_PRIVATE_KEY");
  });
});
