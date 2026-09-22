import { describe, it, expect, beforeEach } from "vitest";
import {
  SignJWT,
  UnsecuredJWT,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  type JWK,
  type KeyLike,
} from "jose";
import {
  ALLOWED_JWS_ALGS,
  clearVerifyCache,
  importPublicKey,
  verifyDidJws,
  verifyDomain,
} from "../src/index.js";
import type { DidDocument } from "../src/types.js";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function compact(header: unknown, payload: unknown, sig = "sig"): string {
  return `${b64url(header)}.${b64url(payload)}.${sig}`;
}

async function didWithPem(
  domain: string,
  alg: "EdDSA" | "ES256"
): Promise<{ did: DidDocument; publicKey: KeyLike }> {
  const { publicKey, privateKey } =
    alg === "EdDSA"
      ? await generateKeyPair("EdDSA", { crv: "Ed25519" })
      : await generateKeyPair(alg);
  const pem = await exportSPKI(publicKey);
  const didId = `did:web:${domain}`;
  const jws = await new SignJWT({ id: didId })
    .setProtectedHeader({ alg })
    .sign(privateKey);
  const did: DidDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: didId,
    verificationMethod: [
      {
        id: `${didId}#key-1`,
        type: "JsonWebKey2020",
        controller: didId,
        publicKeyPem: pem,
      },
    ],
    proof: { type: "JsonWebSignature2020", jws },
  };
  return { did, publicKey };
}

describe("JWS algorithm allowlist", () => {
  beforeEach(() => {
    clearVerifyCache();
  });

  it("allowlists EdDSA (Ed25519) and ES256 only", () => {
    expect([...ALLOWED_JWS_ALGS]).toEqual(["EdDSA", "ES256"]);
    expect(ALLOWED_JWS_ALGS).not.toContain("none");
    expect(ALLOWED_JWS_ALGS).not.toContain("HS256");
    expect(ALLOWED_JWS_ALGS).not.toContain("RS256");
  });

  it.each(["EdDSA", "ES256"] as const)("accepts a valid %s proof", async (alg) => {
    const { did } = await didWithPem(`${alg.toLowerCase()}.example`, alg);
    const key = await importPublicKey(did);
    expect(key).toBeTruthy();
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(true);
  });

  it("rejects alg none from an unsecured JWT", async () => {
    const { did } = await didWithPem("none.example", "ES256");
    did.proof = {
      type: "JsonWebSignature2020",
      jws: new UnsecuredJWT({ id: did.id }).encode(),
    };
    const key = await importPublicKey(did);
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/none/i);
  });

  it("rejects a hand-rolled alg none token with an empty signature", async () => {
    const { did } = await didWithPem("none-empty.example", "EdDSA");
    did.proof = {
      type: "JsonWebSignature2020",
      jws: `${b64url({ alg: "none" })}.${b64url({ id: did.id })}.`,
    };
    const key = await importPublicKey(did);
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Disallowed JWS algorithm: none");
  });

  it.each(["none", "None", "NONE", "nOnE"])(
    "rejects alg %s regardless of case",
    async (alg) => {
      const { did } = await didWithPem("none-case.example", "ES256");
      did.proof = {
        type: "JsonWebSignature2020",
        jws: compact({ alg }, { id: did.id }, ""),
      };
      const key = await importPublicKey(did);
      const result = await verifyDidJws(did, key!);
      expect(result.ok).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("none");
    }
  );

  it("rejects a valid HS256 signature", async () => {
    const secret = new TextEncoder().encode("super-secret-key-at-least-32b!!");
    const didId = "did:web:hmac.example";
    const jws = await new SignJWT({ id: didId })
      .setProtectedHeader({ alg: "HS256" })
      .sign(secret);
    const did: DidDocument = {
      id: didId,
      proof: { type: "JsonWebSignature2020", jws },
    };
    const result = await verifyDidJws(did, secret);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Disallowed symmetric JWS algorithm: HS256");
  });

  it.each(["HS256", "HS384", "HS512", "hs256"] as const)(
    "rejects symmetric alg %s",
    async (alg) => {
      const { did } = await didWithPem("symmetric.example", "ES256");
      const parts = did.proof!.jws!.split(".");
      parts[0] = b64url({ alg });
      did.proof = { type: "JsonWebSignature2020", jws: parts.join(".") };
      const key = await importPublicKey(did);
      const result = await verifyDidJws(did, key!);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(`Disallowed symmetric JWS algorithm: ${alg}`);
    }
  );

  it("rejects a valid RS256 signature", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const didId = "did:web:rsa.example";
    const jws = await new SignJWT({ id: didId })
      .setProtectedHeader({ alg: "RS256" })
      .sign(privateKey);
    const did: DidDocument = {
      id: didId,
      proof: { type: "JsonWebSignature2020", jws },
    };
    const result = await verifyDidJws(did, publicKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Disallowed JWS algorithm: RS256");
  });

  it.each(["PS256", "ES384", "RS384", "ES512"] as const)(
    "rejects disallowed alg %s",
    async (alg) => {
      const { did } = await didWithPem("disallowed.example", "ES256");
      const parts = did.proof!.jws!.split(".");
      parts[0] = b64url({ alg });
      did.proof = { type: "JsonWebSignature2020", jws: parts.join(".") };
      const key = await importPublicKey(did);
      expect(key).toBeTruthy();
      const result = await verifyDidJws(did, key!);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(`Disallowed JWS algorithm: ${alg}`);
    }
  );

  it("fails closed when alg is missing", async () => {
    const { did } = await didWithPem("missing-alg.example", "EdDSA");
    did.proof = {
      type: "JsonWebSignature2020",
      jws: compact({ typ: "JWT" }, { id: did.id }),
    };
    const key = await importPublicKey(did);
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Invalid or missing JWS alg header");
  });

  it.each([
    [{ alg: "" }, "Invalid or missing JWS alg header"],
    [{ alg: null }, "Invalid or missing JWS alg header"],
    [{ alg: ["ES256"] }, "Invalid or missing JWS alg header"],
    [{ alg: 256 }, "Invalid or missing JWS alg header"],
  ])("fails closed on invalid alg header %j", async (header, reason) => {
    const { did } = await didWithPem("bad-header.example", "ES256");
    did.proof = {
      type: "JsonWebSignature2020",
      jws: compact(header, { id: did.id }),
    };
    const key = await importPublicKey(did);
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it("fails closed on a malformed protected header", async () => {
    const { did } = await didWithPem("malformed.example", "EdDSA");
    did.proof = { type: "JsonWebSignature2020", jws: "!!!.@@@.sig" };
    const key = await importPublicKey(did);
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Invalid or missing JWS protected header");
  });

  it("does not accept an EdDSA header for a P-256 key", async () => {
    const { did } = await didWithPem("swap.example", "ES256");
    const parts = did.proof!.jws!.split(".");
    parts[0] = b64url({ alg: "EdDSA" });
    did.proof = { type: "JsonWebSignature2020", jws: parts.join(".") };
    const key = await importPublicKey(did);
    const result = await verifyDidJws(did, key!);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match verification key/);
  });

  it("returns RISK from verifyDomain when the DID proof uses alg none", async () => {
    const domain = "unsigned.example";
    const { did } = await didWithPem(domain, "EdDSA");
    did.proof = {
      type: "JsonWebSignature2020",
      jws: new UnsecuredJWT({ id: did.id }).encode(),
    };
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/did.json")) {
        return new Response(JSON.stringify(did), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const result = await verifyDomain(domain, {
      fetch: fetchFn,
      verificationApiUrl: "https://api.trustflow.systems",
    });
    expect(result.status).toBe("RISK");
    expect(result.reason).toMatch(/none/i);
  });

  it("imports an Ed25519 JWK with no alg and verifies EdDSA", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
    });
    const jwk = (await exportJWK(publicKey)) as JWK;
    delete jwk.alg;
    const didId = "did:web:jwk.example";
    const jws = await new SignJWT({ id: didId })
      .setProtectedHeader({ alg: "EdDSA" })
      .sign(privateKey);
    const did: DidDocument = {
      id: didId,
      verificationMethod: [
        {
          id: `${didId}#key-1`,
          type: "JsonWebKey2020",
          controller: didId,
          publicKeyJwk: jwk as unknown as Record<string, unknown>,
        },
      ],
      proof: { type: "JsonWebSignature2020", jws },
    };
    const key = await importPublicKey(did);
    expect(key).toBeTruthy();
    expect((await verifyDidJws(did, key!)).ok).toBe(true);
  });

  it("refuses a JWK that declares alg none", async () => {
    const { publicKey } = await generateKeyPair("ES256");
    const jwk = (await exportJWK(publicKey)) as JWK;
    jwk.alg = "none";
    const did: DidDocument = {
      id: "did:web:badjwk.example",
      verificationMethod: [
        {
          id: "#key-1",
          type: "JsonWebKey2020",
          controller: "did:web:badjwk.example",
          publicKeyJwk: jwk as unknown as Record<string, unknown>,
        },
      ],
    };
    expect(await importPublicKey(did)).toBeNull();
  });
});
