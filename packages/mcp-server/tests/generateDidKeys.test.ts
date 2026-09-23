import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateKey } from "node:crypto";
import { importPublicKey, verifyDidJws } from "@trustflow/sdk";
import { describe, expect, it } from "vitest";
import { generateDidKeys, PRIVATE_KEY_SECRET_WARNING } from "../src/generateDidKeys.js";

describe("generateDidKeys", () => {
  it("defaults to an Ed25519 did:web document and returns the private key as a secret", async () => {
    const result = await generateDidKeys({ domain: "Example.COM" });
    expect(result.domain).toBe("example.com");
    expect(result.algorithm).toBe("Ed25519");
    expect(result.did).toBe("did:web:example.com");
    expect(result.didDocument["@context"]).toContain("https://www.w3.org/ns/did/v1");
    expect(result.didDocument.service?.[0]?.serviceEndpoint).toBe("https://example.com/.well-known/llms.txt");
    expect(result.didJson).toBe(`${JSON.stringify(result.didDocument, null, 2)}\n`);
    expect(result.didJson).not.toContain("PRIVATE KEY");
    expect(result.privateKeyPem).toContain("PRIVATE KEY");
    expect(result.secret.label).toBe("SECRET");
    expect(result.secret.field).toBe("privateKeyPem");
    expect(result.secret.warning).toBe(PRIVATE_KEY_SECRET_WARNING);
    expect(result.secret.writtenTo).toBeUndefined();
    expect(createPrivateKey(result.privateKeyPem).asymmetricKeyType).toBe("ed25519");

    const key = await importPublicKey(result.didDocument);
    expect((await verifyDidJws(result.didDocument, key!)).ok).toBe(true);
  });

  it("signs an ES256 P-256 document through the SDK", async () => {
    const result = await generateDidKeys({ domain: "p256.example", algorithm: "P-256" });
    expect(result.algorithm).toBe("ES256");
    expect(createPrivateKey(result.privateKeyPem).asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    const key = await importPublicKey(result.didDocument);
    expect((await verifyDidJws(result.didDocument, key!)).ok).toBe(true);
    expect(result.didJson).not.toContain("PRIVATE KEY");
  });

  it("writes the private key only when privateKeyPath is set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentic-trust-mcp-keys-"));
    const untouched = await generateDidKeys({ domain: "nowrite.example" });
    expect(untouched.secret.writtenTo).toBeUndefined();

    const target = path.join(dir, "secrets", "domain.pem");
    const written = await generateDidKeys({ domain: "write.example", privateKeyPath: target });
    expect(written.secret.writtenTo).toBe(path.resolve(target));
    const onDisk = await readFile(target, "utf8");
    expect(onDisk).toBe(written.privateKeyPem.endsWith("\n") ? written.privateKeyPem : `${written.privateKeyPem}\n`);
    const mode = (await stat(target)).mode & 0o777;
    if (process.platform === "win32") expect(mode & 0o200).toBeTruthy();
    else expect(mode).toBe(0o600);
    expect(written.didJson).not.toContain("PRIVATE KEY");
  });

  it("rejects an unknown algorithm", async () => {
    await expect(generateDidKeys({ domain: "example.com", algorithm: "HS256" })).rejects.toThrow(/Ed25519/);
  });
});
