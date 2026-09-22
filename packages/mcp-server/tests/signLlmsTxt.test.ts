import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSignedDidDocument, importPublicKey, verifyDidJws, type DidDocument } from "@agentic-trust/sdk";
import { describe, expect, it } from "vitest";
import { generateDidKeys } from "../src/generateDidKeys.js";
import { alignLlmsTxt, signLlmsTxt } from "../src/signLlmsTxt.js";

const LLMS = `# Example Co
> Widgets for agents

Domain: example.com

## Services
- Search
`;

describe("signLlmsTxt", () => {
  it("signs the manifest with the domain private key and aligns did:web guidance", async () => {
    const identity = await createSignedDidDocument({ domain: "example.com" });
    const result = await signLlmsTxt({
      domain: "https://example.com/docs",
      privateKeyPem: identity.privateKeyPem,
      llmsTxt: LLMS,
    });

    expect(result.domain).toBe("example.com");
    expect(result.did).toBe("did:web:example.com");
    expect(result.algorithm).toBe("Ed25519");
    expect(result.publicKeyHash).toBe(identity.publicKeyHash);
    expect(result.llmsTxt).toContain("# Example Co");
    expect(result.llmsTxt).toContain("- DID: did:web:example.com");
    expect(result.llmsTxt).toContain("- Manifest: https://example.com/.well-known/did.json");
    expect(result.llmsTxt).toContain("Verified by AgenticTrust");
    expect(result.llmsTxt).not.toContain("PRIVATE KEY");
    expect(result.didJson).not.toContain("PRIVATE KEY");
    expect(result.artifacts[".well-known/llms.txt"]).toBe(result.llmsTxt);
    expect(result.artifacts[".well-known/did.json"]).toBe(result.didJson);
    expect(result.didDocument.service?.[0]?.serviceEndpoint).toBe("https://example.com/.well-known/llms.txt");
    expect(result.guidance.join("\n")).toContain("https://api.trustflow.systems/v1/register");
    expect(result.written).toBeUndefined();

    const key = await importPublicKey(result.didDocument);
    expect((await verifyDidJws(result.didDocument, key!)).ok).toBe(true);
  });

  it("reads llms.txt from a path and writes public artifacts only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentic-trust-mcp-sign-"));
    const source = path.join(dir, "incoming-llms.txt");
    const stale = `# Kept
> Kept description

Domain: kept.example

## Identity
- DID: did:web:other.example
- Manifest: https://other.example/.well-known/did.json

## Trust
Verified by AgenticTrust. Registry: Trustflow Systems (https://trustflow.systems).
Agents should call verifyDomain before tool invocation.
`;
    await writeFile(source, stale, "utf8");
    const identity = await createSignedDidDocument({ domain: "kept.example" });
    const outputDir = path.join(dir, "out");

    const result = await signLlmsTxt({
      domain: "kept.example",
      privateKeyPem: identity.privateKeyPem,
      llmsTxtPath: source,
      outputDir,
    });

    expect(result.llmsTxt).toContain("- DID: did:web:kept.example");
    expect(result.llmsTxt).not.toContain("did:web:other.example");
    expect(result.llmsTxt).toContain("https://kept.example/.well-known/did.json");
    expect(result.llmsTxt.match(/## Identity/g)).toHaveLength(1);
    expect(result.llmsTxt.match(/## Trust/g)).toHaveLength(1);

    const did = JSON.parse(await readFile(path.join(outputDir, ".well-known", "did.json"), "utf8")) as DidDocument;
    expect(did.id).toBe("did:web:kept.example");
    expect((await verifyDidJws(did, (await importPublicKey(did))!)).ok).toBe(true);
    const published = await readFile(path.join(outputDir, "llms.txt"), "utf8");
    const wellKnown = await readFile(path.join(outputDir, ".well-known", "llms.txt"), "utf8");
    expect(published).toBe(result.llmsTxt);
    expect(wellKnown).toBe(result.llmsTxt);
    expect(published).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(did)).not.toContain("PRIVATE KEY");

    const names = await walk(outputDir);
    expect(names.some((name) => name.endsWith(".pem") || name.includes("private"))).toBe(false);
    expect(result.written).toEqual([
      path.join(outputDir, "llms.txt"),
      path.join(outputDir, ".well-known", "llms.txt"),
      path.join(outputDir, ".well-known", "did.json"),
    ]);
  });

  it("signs with an ES256 key and rejects a missing manifest", async () => {
    const generated = await generateDidKeys({ domain: "es.example", algorithm: "ES256" });
    const signed = await signLlmsTxt({
      domain: "es.example",
      privateKeyPem: generated.privateKeyPem,
      llmsTxt: "# ES\n> curve\n\nDomain: es.example\n",
    });
    expect(signed.algorithm).toBe("ES256");
    expect((await verifyDidJws(signed.didDocument, (await importPublicKey(signed.didDocument))!)).ok).toBe(true);

    await expect(
      signLlmsTxt({ domain: "es.example", privateKeyPem: generated.privateKeyPem })
    ).rejects.toThrow(/llmsTxt/);
    await expect(
      signLlmsTxt({ domain: "es.example", privateKeyPem: "not-a-key", llmsTxt: LLMS })
    ).rejects.toThrow(/Private key PEM/);
  });

  it("leaves a manifest that already names the same did:web", () => {
    const body = `# Name
> Desc

Domain: example.com

## Identity
- DID: did:web:example.com
- Manifest: https://example.com/.well-known/did.json

## Trust
Verified by AgenticTrust. Registry: Trustflow Systems (https://trustflow.systems).
Agents should call verifyDomain before tool invocation.
`;
    const aligned = alignLlmsTxt(body, "example.com");
    expect(aligned).toBe(body.endsWith("\n") ? body : `${body}\n`);
    expect(aligned.match(/## Identity/g)).toHaveLength(1);
  });
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}
