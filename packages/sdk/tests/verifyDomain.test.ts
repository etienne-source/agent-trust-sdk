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
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      const hit = await verifyDomain(domain, { fetch: fetchFn });
      samples.push(performance.now() - start);
      expect(hit.cached).toBe(true);
      expect(hit.status).toBe("VERIFIED");
    }
    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThan(5);
    // did.json only fetched once (+ optional llms)
    const calls = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock
      .calls;
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it("returns UNVERIFIED for an invalid domain instead of throwing", async () => {
    await expect(verifyDomain("not a host")).resolves.toMatchObject({
      status: "UNVERIFIED",
      reason: "Invalid domain",
    });
    await expect(verifyDomain("")).resolves.toMatchObject({
      status: "UNVERIFIED",
      domain: "(empty)",
    });
    await expect(verifyDomain("   ")).resolves.toMatchObject({ status: "UNVERIFIED" });
  });

  it("returns RISK for invalid JSON, a non-document, and a non-did:web id", async () => {
    const domain = "junk.example";
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { text: "<html>nope</html>" },
    });
    const invalid = await verifyDomain(domain, { fetch: fetchFn, verificationApiUrl: "http://api.test" });
    expect(invalid.status).toBe("RISK");
    expect(invalid.reason).toMatch(/not valid JSON/);

    clearVerifyCache();
    const arrayBody = mockFetchRouter({
      "/.well-known/did.json": { body: [] },
    });
    const malformed = await verifyDomain(domain, {
      fetch: arrayBody,
      bypassCache: true,
      verificationApiUrl: "http://api.test",
    });
    expect(malformed.status).toBe("RISK");
    expect(malformed.reason).toMatch(/not a DID document/);

    clearVerifyCache();
    const foreign = mockFetchRouter({
      "/.well-known/did.json": { body: { id: "did:key:z6Mkexample" } },
    });
    const risk = await verifyDomain(domain, {
      fetch: foreign,
      bypassCache: true,
      verificationApiUrl: "http://api.test",
    });
    expect(risk.status).toBe("RISK");
    expect(risk.reason).toMatch(/not did:web/);
  });

  it("returns RISK when did:web names a different host", async () => {
    const { did } = await makeSignedDid("attacker.example");
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/v1/verify": { body: { status: "VERIFIED", domain: "victim.example", claims: {} } },
    });
    const result = await verifyDomain("victim.example", {
      fetch: fetchFn,
      bypassCache: true,
      verificationApiUrl: "http://api.test",
    });
    expect(result.status).toBe("RISK");
    expect(result.reason).toMatch(/does not match domain/);
  });

  it("does not follow a cross-host redirect of did.json", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("victim.example/.well-known/did.json")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/.well-known/did.json" },
        });
      }
      return new Response(JSON.stringify({ status: "UNVERIFIED", domain: "victim.example", claims: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await verifyDomain("victim.example", {
      fetch: fetchFn as unknown as typeof fetch,
      bypassCache: true,
      verificationApiUrl: "http://api.test",
    });
    expect(result.status).not.toBe("VERIFIED");
    expect(calls.some((url) => url.includes("attacker.example"))).toBe(false);
  });

  it("follows one www to apex hop when the DID still names the requested host", async () => {
    const domain = "www.ready.example";
    const { did } = await makeSignedDid(domain);
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://www.ready.example/") && url.includes("did.json")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://ready.example/.well-known/did.json" },
        });
      }
      if (url.startsWith("https://ready.example/") && url.includes("did.json")) {
        return new Response(JSON.stringify(did), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("missing", { status: 404 });
    });
    const result = await verifyDomain(domain, {
      fetch: fetchFn as unknown as typeof fetch,
      bypassCache: true,
      verificationApiUrl: "http://api.test",
    });
    expect(result.status).toBe("VERIFIED");
  });

  it("does not upgrade alg:none or HS256 proofs through the registry", async () => {
    const domain = "downgrade.example";
    const { did } = await makeSignedDid(domain);
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ id: did.id })).toString("base64url");
    did.proof = { type: "JsonWebSignature2020", jws: `${header}.${payload}.` };
    const fetchFn = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/v1/verify": { body: { status: "VERIFIED", domain, claims: {} } },
    });
    const none = await verifyDomain(domain, { fetch: fetchFn, verificationApiUrl: "http://api.test" });
    expect(none.status).toBe("RISK");
    expect(none.reason).toMatch(/Disallowed JWS algorithm: none/);
    const urls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) =>
      String(call[0])
    );
    expect(urls.some((url) => url.includes("/v1/verify"))).toBe(false);

    clearVerifyCache();
    did.proof = {
      type: "JsonWebSignature2020",
      jws: `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${payload}.sig`,
    };
    const hmacFetch = mockFetchRouter({
      "/.well-known/did.json": { body: did },
      "/v1/verify": { body: { status: "VERIFIED", domain, claims: {} } },
    });
    const hmac = await verifyDomain(domain, {
      fetch: hmacFetch,
      bypassCache: true,
      verificationApiUrl: "http://api.test",
    });
    expect(hmac.status).toBe("RISK");
    expect(hmac.reason).toMatch(/Disallowed symmetric JWS algorithm: HS256/);
  });

  it("falls through on network failure and stays UNVERIFIED when the API also fails", async () => {
    const domain = "offline.example";
    let calls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      if (url.includes("/.well-known/did.json")) {
        throw new TypeError("getaddrinfo ENOTFOUND");
      }
      throw new DOMException("The operation was aborted", "TimeoutError");
    }) as unknown as typeof fetch;

    const result = await verifyDomain(domain, {
      fetch: fetchFn,
      verificationApiUrl: "http://api.test",
    });
    expect(result.status).toBe("UNVERIFIED");
    expect(result.reason).toMatch(/API fallback failed/);
    expect(calls).toBe(2);
  });

  it("rejects a registry body that is HTML or the wrong JSON shape", async () => {
    const domain = "api.example";
    const html = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("did.json")) throw new TypeError("offline");
      return new Response("<html>gateway</html>", { status: 200 });
    }) as unknown as typeof fetch;
    const badJson = await verifyDomain(domain, { fetch: html, verificationApiUrl: "http://api.test" });
    expect(badJson.status).toBe("UNVERIFIED");
    expect(badJson.reason).toMatch(/invalid JSON/);

    clearVerifyCache();
    const weird = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("did.json")) throw new TypeError("offline");
      return new Response(JSON.stringify(["nope"]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const unexpected = await verifyDomain(domain, {
      fetch: weird,
      verificationApiUrl: "http://api.test",
    });
    expect(unexpected.status).toBe("UNVERIFIED");
    expect(unexpected.reason).toMatch(/unexpected payload/);
  });
});

describe("inspectEndpointBeforeExecution", () => {
  beforeEach(() => clearVerifyCache());

  it("blocks non-HTTPS and unparseable endpoints without throwing", async () => {
    const r = await inspectEndpointBeforeExecution("http://example.com/mcp");
    expect(r.allowed).toBe(false);
    expect(r.status).toBe("RISK");
    await expect(inspectEndpointBeforeExecution("not a url")).resolves.toMatchObject({
      allowed: false,
      status: "RISK",
    });
    await expect(inspectEndpointBeforeExecution("")).resolves.toMatchObject({ allowed: false });
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
