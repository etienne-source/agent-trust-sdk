import { describe, expect, it } from "vitest";
import { importPublicKey, verifyDidJws } from "../src/jws.js";
import { createSignedDidDocument, hashPublicKeyPem } from "../src/identity.js";

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
});
