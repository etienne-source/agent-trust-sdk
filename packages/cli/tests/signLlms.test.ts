import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hashLlmsTxt, importPublicKey, verifyDidJws, type DidDocument } from "@trustflow/sdk";
import { main } from "../src/cli.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-sign-llms-"));
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line?: string) => lines.push(line ?? "") };
}

const initArgs = [
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

async function scaffold(cwd: string): Promise<void> {
  const code = await main(initArgs, { cwd, log: () => undefined, stdinIsTTY: false });
  expect(code).toBe(0);
}

describe("trustflow sign-llms", () => {
  it("rewrites the did.json JWS and does not call /v1/register", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "public"));
    await scaffold(cwd);
    const didPath = path.join(cwd, "public", ".well-known", "did.json");
    const llmsPath = path.join(cwd, "public", "llms.txt");
    const before = JSON.parse(await readFile(didPath, "utf8")) as DidDocument;
    const llmsBefore = await readFile(llmsPath, "utf8");
    const publicKeyPem = before.verificationMethod?.[0]?.publicKeyPem;
    before.proof = { type: "JsonWebSignature2020", jws: "not-a-signature" };
    await writeFile(didPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0" } }),
      "utf8"
    );
    const fetch = vi.fn();
    const { lines, log } = capture();
    const code = await main(["sign-llms"], {
      cwd,
      log,
      fetch: fetch as unknown as typeof globalThis.fetch,
      stdinIsTTY: false,
    });
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    const output = lines.join("\n");
    expect(output).toContain("Did not call POST /v1/register");
    expect(output).not.toContain("/v1/register/confirm");
    expect(output).not.toContain("PRIVATE KEY");

    expect(await readFile(llmsPath, "utf8")).toBe(llmsBefore);
    await expect(readFile(path.join(cwd, ".well-known", "agentic-trust-challenge.txt"), "utf8")).rejects.toThrow();
    await expect(
      readFile(path.join(cwd, "public", ".well-known", "agentic-trust-challenge.txt"), "utf8")
    ).rejects.toThrow();
    await expect(readFile(path.join(cwd, ".agentic-trust", "registration.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, "llms.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(cwd, ".well-known", "did.json"), "utf8")).rejects.toThrow();

    const after = JSON.parse(await readFile(didPath, "utf8")) as DidDocument;
    expect(after.id).toBe(before.id);
    expect(after.verificationMethod?.[0]?.publicKeyPem).toBe(publicKeyPem);
    expect(after.proof?.jws).toBeTruthy();
    expect(after.proof?.jws).not.toBe("not-a-signature");
    expect(after.proof?.jws?.split(".")).toHaveLength(3);
    const key = await importPublicKey(after);
    const verified = await verifyDidJws(after, key!);
    expect(verified.ok).toBe(true);
    expect(after.llmsTxtSha256).toBe(hashLlmsTxt(llmsBefore));
    expect(verified.llmsTxtSha256).toBe(after.llmsTxtSha256);
  });

  it("fails when llms.txt, keys, or did.json are missing", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      errors.push(String(line ?? ""));
    });
    try {
      const missingLlms = await tempProject();
      await mkdir(path.join(missingLlms, ".agentic-trust"), { recursive: true });
      await writeFile(path.join(missingLlms, ".agentic-trust", "private-key.pem"), "key", "utf8");
      await writeFile(path.join(missingLlms, ".agentic-trust", "public-key.pem"), "pub", "utf8");
      await mkdir(path.join(missingLlms, ".well-known"), { recursive: true });
      await writeFile(path.join(missingLlms, ".well-known", "did.json"), "{}", "utf8");
      expect(await main(["sign-llms"], { cwd: missingLlms, log: () => undefined, stdinIsTTY: false })).toBe(1);
      expect(errors.join("\n")).toContain("Missing llms.txt");

      errors.length = 0;
      const missingKeys = await tempProject();
      await scaffold(missingKeys);
      const { rm } = await import("node:fs/promises");
      await rm(path.join(missingKeys, ".agentic-trust"), { recursive: true });
      expect(await main(["sign-llms"], { cwd: missingKeys, log: () => undefined, stdinIsTTY: false })).toBe(1);
      expect(errors.join("\n")).toContain("Missing .agentic-trust/private-key.pem");

      errors.length = 0;
      const missingDid = await tempProject();
      await scaffold(missingDid);
      await rm(path.join(missingDid, "public", ".well-known", "did.json"));
      await rm(path.join(missingDid, ".well-known", "did.json"));
      expect(await main(["sign-llms"], { cwd: missingDid, log: () => undefined, stdinIsTTY: false })).toBe(1);
      expect(errors.join("\n")).toContain("Missing did.json");
    } finally {
      spy.mockRestore();
    }
  });
});
