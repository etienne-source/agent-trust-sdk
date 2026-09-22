import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import {
  verifyDomain,
  clearVerifyCache,
  inspectEndpointBeforeExecution,
} from "../src/index.js";
import type { DidDocument } from "../src/types.js";

async function makeSignedDid(domain: string) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const pem = await exportSPKI(publicKey);
  const didId = `did:web:${domain}`;

  const payloadDoc = {
    id: didId,
    verificationMethod: [
      {
        id: `${didId}#key-1`,
        type: "JsonWebKey2020",
        controller: didId,
        publicKeyPem: pem,
      },
    ],
    assertionMethod: [`${didId}#key-1`],
    service: [
      {
        id: `${didId}#mcp`,
        type: "MCP",
        serviceEndpoint: `https://${domain}/mcp`,
      },
    ],
  };

  const jws = await new SignJWT(payloadDoc)
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(privateKey);

  const did: DidDocument = {
    ...payloadDoc,
    "@context": ["https://www.w3.org/ns/did/v1"],
    proof: {
      type: "JsonWebSignature2020",
      jws,
      verificationMethod: `${didId}#key-1`,
    },
  };

  return { did, pem };
}

function mockFetchRouter(
  routes: Record<string, { status?: number; body?: unknown; text?: string }>
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([k]) => url.includes(k));
    if (!match) {
      return new Response("not found", { status: 404 });
    }
    const [, cfg] = match;
    if (cfg.text !== undefined) {
      return new Response(cfg.text, { status: cfg.status ?? 200 });
    }
    return new Response(JSON.stringify(cfg.body ?? {}), {
      status: cfg.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("verifyDomain", () => {
  beforeEach(() => {
    clearVerifyCache();
  });

  it("returns VERIFIED for valid did.json + JWS", async () => {
    const domain = "readyaccounting.co.za";
    const { did } = await makeSignedDid(domain);
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/.well-known/llms.txt": {
        text: "# Ready Accounting\n> Bookkeeping for SMEs",
      },
    });

    const result = await verifyDomain(domain, {
      fetch: fetchFn,
      verificationApiUrl: "http://api.test",
    });

    expect(result.status).toBe("VERIFIED");
    expect(result.domain).toBe(domain);
    expect(result.claims.llmsTxtPresent).toBe(true);
    expect(result.claims.did).toBe(`did:web:${domain}`);
    expect(result.cached).toBeFalsy();
  });

  it("returns UNVERIFIED when did.json missing and API says so", async () => {
    const domain = "missing.example";
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { status: 404, body: {} },
      "/v1/verify": {
        body: {
          status: "UNVERIFIED",
          domain,
          claims: {},
          reason: "Not registered",
        },
      },
    });

    const result = await verifyDomain(domain, {
      fetch: fetchFn,
      verificationApiUrl: "http://api.test",
    });

    expect(result.status).toBe("UNVERIFIED");
    expect(result.domain).toBe(domain);
  });

  it("returns RISK when JWS signature is invalid", async () => {
    const domain = "evil.example";
    const { did } = await makeSignedDid(domain);
    const parts = did.proof?.jws?.split(".") ?? [];
    did.proof = {
      type: "JsonWebSignature2020",
      jws: `${parts[0]}.${parts[1]}.invalid-signature`,
    };

    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/.well-known/llms.txt": { status: 404, text: "" },
    });

    const result = await verifyDomain(domain, {
      fetch: fetchFn,
      verificationApiUrl: "http://api.test",
    });

    expect(result.status).toBe("RISK");
    expect(result.reason).toBeTruthy();
  });

  it("serves cache on second call", async () => {
    const domain = "cached.example";
    const { did } = await makeSignedDid(domain);
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/.well-known/llms.txt": { status: 404, text: "" },
    });

    await verifyDomain(domain, { fetch: fetchFn });
    const second = await verifyDomain(domain, { fetch: fetchFn });
    expect(second.cached).toBe(true);
    expect(second.status).toBe("VERIFIED");
    // did.json only fetched once (+ optional llms)
    const calls = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock
      .calls;
    expect(calls.length).toBeLessThanOrEqual(2);
  });
});

describe("inspectEndpointBeforeExecution", () => {
  beforeEach(() => clearVerifyCache());

  it("blocks non-HTTPS endpoints", async () => {
    const r = await inspectEndpointBeforeExecution("http://example.com/mcp");
    expect(r.allowed).toBe(false);
    expect(r.status).toBe("RISK");
  });

  it("allows listed MCP endpoint on verified domain", async () => {
    const domain = "mcpgood.example";
    const { did } = await makeSignedDid(domain);
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/.well-known/llms.txt": { status: 404, text: "" },
    });

    const r = await inspectEndpointBeforeExecution(`https://${domain}/mcp`, {
      fetch: fetchFn,
    });
    expect(r.allowed).toBe(true);
    expect(r.status).toBe("VERIFIED");
  });
});
