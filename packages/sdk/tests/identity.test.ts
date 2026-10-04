import { describe, expect, it } from "vitest";
import { importPublicKey, verifyDidJws } from "../src/jws.js";
import { compactVerify, importSPKI } from "jose";
import { createSignedDidDocument, hashPublicKeyPem, signRegisterConfirmProof } from "../src/identity.js";
import { assertLlmsTxtDomain, llmsTxtDomains } from "../src/llmsManifest.js";

describe("createSignedDidDocument", () => {
  it("signs a did:web document that verifyDidJws accepts", async () => {
    const identity = await createSignedDidDocument({ domain: "Example.COM" });
    expect(identity.domain).toBe("example.com");
    expect(identity.did.id).toBe("did:web:example.com");
    expect(identity.publicKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.publicKeyHash).toBe(hashPublicKeyPem(identity.publicKeyPem));
    expect(identity.privateKeyPem).toContain("PRIVATE KEY");
    expect(identity.did.proof?.jws).toBeTruthy();

    const key = await importPublicKey(identity.did);
    expect(key).toBeTruthy();
    const verified = await verifyDidJws(identity.did, key!);
    expect(verified.ok).toBe(true);

    const again = await createSignedDidDocument({
      domain: "example.com",
      privateKeyPem: identity.privateKeyPem,
      publicKeyPem: identity.publicKeyPem,
    });
    expect(again.publicKeyHash).toBe(identity.publicKeyHash);

    const fromPrivateOnly = await createSignedDidDocument({
      domain: "example.com",
      privateKeyPem: identity.privateKeyPem,
    });
    expect(fromPrivateOnly.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(fromPrivateOnly.did.verificationMethod?.[0]?.publicKeyPem).toBe(fromPrivateOnly.publicKeyPem);
    const derivedKey = await importPublicKey(fromPrivateOnly.did);
    expect((await verifyDidJws(fromPrivateOnly.did, derivedKey!)).ok).toBe(true);
    expect(JSON.stringify(fromPrivateOnly.did)).not.toContain("PRIVATE KEY");
    const key2 = await importPublicKey(again.did);
    expect((await verifyDidJws(again.did, key2!)).ok).toBe(true);
  });

  it("refuses a publicKeyPem that does not match the private key", async () => {
    const signer = await createSignedDidDocument({ domain: "example.com" });
    const other = await createSignedDidDocument({ domain: "example.com" });
    await expect(
      createSignedDidDocument({
        domain: "example.com",
        privateKeyPem: signer.privateKeyPem,
        publicKeyPem: other.publicKeyPem,
      })
    ).rejects.toThrow(/does not match privateKeyPem/);
  });
});

describe("signRegisterConfirmProof", () => {
  it("signs purpose, domain, and challengeToken and does not embed the private key", async () => {
    const identity = await createSignedDidDocument({ domain: "Proof.Example" });
    const proof = await signRegisterConfirmProof({
      domain: "Proof.Example",
      challengeToken: "challenge-1",
      privateKeyPem: identity.privateKeyPem,
    });
    expect(proof.split(".")).toHaveLength(3);
    expect(proof).not.toContain("PRIVATE KEY");
    const key = await importSPKI(identity.publicKeyPem, "EdDSA");
    const verified = await compactVerify(proof, key, { algorithms: ["EdDSA"] });
    expect(JSON.parse(new TextDecoder().decode(verified.payload))).toEqual({
      purpose: "trustflow-register-confirm",
      domain: "proof.example",
      challengeToken: "challenge-1",
    });
  });
});

describe("assertLlmsTxtDomain", () => {
  const body = [
    "# Shop",
    "Domain: shop.example",
    "- DID: did:web:shop.example",
    "- Manifest: https://shop.example/.well-known/did.json",
    "",
  ].join("\n");

  it("accepts an llms.txt that names the signing domain", () => {
    expect(llmsTxtDomains(body)).toEqual(["shop.example"]);
    expect(() => assertLlmsTxtDomain(body, "shop.example")).not.toThrow();
  });

  it("refuses an llms.txt copied from another domain", () => {
    expect(() => assertLlmsTxtDomain(body, "victim.example")).toThrow(/names shop\.example, not victim\.example/);
  });
});
