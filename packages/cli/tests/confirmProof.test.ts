import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compactVerify, importSPKI } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createSignedDidDocument } from "@trustflow/sdk";
import { main } from "../src/cli.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-confirm-proof-"));
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

interface ConfirmBody {
  domain?: string;
  challengeToken?: string;
  proof?: string;
}

async function expectValidConfirmProof(
  body: ConfirmBody,
  publicKeyPem: string,
  domain: string,
  challengeToken: string,
  privateKeyPem: string
): Promise<void> {
  expect(body.domain).toBe(domain);
  expect(body.challengeToken).toBe(challengeToken);
  expect(typeof body.proof).toBe("string");
  expect(body.proof?.split(".")).toHaveLength(3);
  expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
  expect(JSON.stringify(body)).not.toContain(privateKeyPem);

  const key = await importSPKI(publicKeyPem, "EdDSA");
  const verified = await compactVerify(body.proof!, key, { algorithms: ["EdDSA"] });
  const payload = JSON.parse(new TextDecoder().decode(verified.payload)) as {
    domain?: string;
    challengeToken?: string;
  };
  expect(payload).toEqual({ domain, challengeToken });
}

describe("register confirm private-key proof", () => {
  it("init --confirm, sign --confirm, and confirm send a compact JWS proof and never print the key", async () => {
    const cwd = await tempProject();
    const confirmBodies: ConfirmBody[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/.well-known/did.json")) {
        const body = await readFile(path.join(cwd, "public", ".well-known", "did.json"), "utf8");
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (method === "GET" && url.includes("agentic-trust-challenge.txt")) {
        return new Response("proof-token", { status: 200 });
      }
      if (url.endsWith("/v1/register/confirm")) {
        const body = JSON.parse(String(init?.body)) as ConfirmBody;
        confirmBodies.push(body);
        return jsonResponse({ status: "VERIFIED", domain: "proof.example" });
      }
      return jsonResponse({
        domain: "proof.example",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "proof-token",
        challengePath: "https://proof.example/.well-known/agentic-trust-challenge.txt",
        instructions: "Serve the challenge token, then POST /v1/register/confirm.",
        expiresAt: "2026-10-04T00:00:00.000Z",
      });
    });

    const init = capture();
    const initCode = await main(
      [
        "init",
        "--non-interactive",
        "--confirm",
        "--domain",
        "proof.example",
        "--name",
        "Proof Co",
        "--description",
        "Proofs",
      ],
      { cwd, log: init.log, fetch: fetch as unknown as typeof globalThis.fetch, stdinIsTTY: false }
    );
    expect(initCode).toBe(0);
    const privateKeyPem = await readFile(path.join(cwd, ".agentic-trust", "private-key.pem"), "utf8");
    const publicKeyPem = await readFile(path.join(cwd, ".agentic-trust", "public-key.pem"), "utf8");
    expect(confirmBodies).toHaveLength(1);
    await expectValidConfirmProof(confirmBodies[0]!, publicKeyPem, "proof.example", "proof-token", privateKeyPem);
    expect(init.lines.join("\n")).not.toContain("PRIVATE KEY");
    expect(init.lines.join("\n")).not.toContain(privateKeyPem.trim());

    const confirm = capture();
    const confirmCode = await main(["confirm"], {
      cwd,
      log: confirm.log,
      fetch: fetch as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
    });
    expect(confirmCode).toBe(0);
    expect(confirmBodies).toHaveLength(2);
    await expectValidConfirmProof(confirmBodies[1]!, publicKeyPem, "proof.example", "proof-token", privateKeyPem);
    expect(confirm.lines.join("\n")).not.toContain("PRIVATE KEY");

    const signer = await createSignedDidDocument({ domain: "sign.example" });
    const signCwd = await tempProject();
    await mkdir(path.join(signCwd, "public"), { recursive: true });
    await writeFile(
      path.join(signCwd, "public", "llms.txt"),
      "# Sign Co\n> Signed\n\nDomain: sign.example\n",
      "utf8"
    );
    const signFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/register/confirm")) {
        const body = JSON.parse(String(init?.body)) as ConfirmBody;
        confirmBodies.push(body);
        return jsonResponse({ status: "VERIFIED", domain: "sign.example" });
      }
      return jsonResponse({
        domain: "sign.example",
        verificationType: "SSL_CHALLENGE",
        challengeToken: "sign-token",
        challengePath: "https://sign.example/.well-known/agentic-trust-challenge.txt",
        instructions: "Serve the challenge token, then POST /v1/register/confirm.",
        expiresAt: "2026-10-04T00:00:00.000Z",
      });
    });
    const sign = capture();
    const signCode = await main(["sign", "--domain", "sign.example", "--confirm"], {
      cwd: signCwd,
      log: sign.log,
      fetch: signFetch as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
      env: {
        AGENTIC_TRUST_PRIVATE_KEY: signer.privateKeyPem,
        AGENTIC_TRUST_DRY_RUN: "false",
        AGENTIC_TRUST_CONFIRM: "true",
      },
    });
    expect(signCode).toBe(0);
    const signBody = confirmBodies[confirmBodies.length - 1]!;
    await expectValidConfirmProof(signBody, signer.publicKeyPem, "sign.example", "sign-token", signer.privateKeyPem);
    expect(sign.lines.join("\n")).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(signFetch.mock.calls)).not.toContain("PRIVATE KEY");
  });
});
