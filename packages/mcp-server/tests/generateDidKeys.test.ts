import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateKey } from "node:crypto";
import { hashPublicKeyPem, publicKeyPemFromPrivate } from "@trustflow/sdk";
import { describe, expect, it } from "vitest";
import { generateDidKeys, PRIVATE_KEY_SECRET_WARNING } from "../src/generateDidKeys.js";

describe("generateDidKeys", () => {
  it("defaults to an Ed25519 key pair and does not return a signed did.json", async () => {
    const result = await generateDidKeys({ domain: "Example.COM" });
    expect(result.domain).toBe("example.com");
    expect(result.algorithm).toBe("Ed25519");
    expect(result.did).toBe("did:web:example.com");
    expect(result.privateKeyPem).toContain("PRIVATE KEY");
    expect(result.publicKeyPem).toContain("PUBLIC KEY");
    expect(result.publicKeyHash).toBe(hashPublicKeyPem(publicKeyPemFromPrivate(result.privateKeyPem!)));
    expect(result.publicKeyPem).toBe(publicKeyPemFromPrivate(result.privateKeyPem!));
    expect(result).not.toHaveProperty("didJson");
    expect(result).not.toHaveProperty("didDocument");
    expect(result.secret.label).toBe("SECRET");
    expect(result.secret.field).toBe("privateKeyPem");
    expect(result.secret.warning).toBe(PRIVATE_KEY_SECRET_WARNING);
    expect(result.secret.writtenTo).toBeUndefined();
    expect(createPrivateKey(result.privateKeyPem!).asymmetricKeyType).toBe("ed25519");
  });

  it("returns an ES256 P-256 key pair without a signed document", async () => {
    const result = await generateDidKeys({ domain: "p256.example", algorithm: "P-256" });
    expect(result.algorithm).toBe("ES256");
    expect(createPrivateKey(result.privateKeyPem!).asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(result.publicKeyHash).toBe(hashPublicKeyPem(result.publicKeyPem));
    expect(JSON.stringify(result)).not.toContain('"jws"');
  });

  it("writes the private key only when privateKeyPath is set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentic-trust-mcp-keys-"));
    const untouched = await generateDidKeys({ domain: "nowrite.example" });
    expect(untouched.secret.writtenTo).toBeUndefined();

    const target = path.join(dir, "secrets", "domain.pem");
    const written = await generateDidKeys({ domain: "write.example", privateKeyPath: target });
    expect(written.secret.writtenTo).toBe(path.resolve(target));
    const onDisk = await readFile(target, "utf8");
    expect(onDisk).toBe(written.privateKeyPem!.endsWith("\n") ? written.privateKeyPem : `${written.privateKeyPem}\n`);
    const mode = (await stat(target)).mode & 0o777;
    if (process.platform === "win32") expect(mode & 0o200).toBeTruthy();
    else expect(mode).toBe(0o600);
    expect(JSON.stringify(written)).not.toContain("didDocument");
  });

  it("rejects an unknown algorithm", async () => {
    await expect(generateDidKeys({ domain: "example.com", algorithm: "HS256" })).rejects.toThrow(/Ed25519/);
  });

  it("does not overwrite an existing key file and stays inside rootDir", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentic-trust-mcp-keys-"));
    const target = path.join(dir, "keep.pem");
    await writeFile(target, "existing\n", "utf8");
    await expect(generateDidKeys({ domain: "keep.example", privateKeyPath: target })).rejects.toThrow(
      /already exists/
    );
    expect(await readFile(target, "utf8")).toBe("existing\n");

    await expect(
      generateDidKeys({
        domain: "out.example",
        privateKeyPath: "../escape.pem",
        rootDir: dir,
        returnPrivateKey: false,
      })
    ).rejects.toThrow(/must be inside/);

    const omitted = generateDidKeys({ domain: "omit.example", returnPrivateKey: false });
    await expect(omitted).rejects.toThrow(/privateKeyPath is required/);
  });
});
