import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  agenticTrustMiddleware,
  clearVerifyCache,
  defaultCache,
} from "../src/index.js";

const API = "https://api.trustflow.systems";

function verifiedBody(domain: string, trustScore = 91) {
  return {
    status: "VERIFIED",
    domain,
    claims: {
      did: `did:web:${domain}`,
      trustScore,
    },
  };
}

type RouteResult = { status?: number; body?: unknown; text?: string; throw?: Error };

function mockFetch(routes: Record<string, RouteResult>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted", "TimeoutError");
    }
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) {
      return new Response("not found", { status: 404 });
    }
    const cfg = match[1];
    if (cfg.throw) throw cfg.throw;
    if (cfg.text !== undefined) {
      return new Response(cfg.text, {
        status: cfg.status ?? 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response(JSON.stringify(cfg.body ?? {}), {
      status: cfg.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function verifyCalls(fetchFn: typeof fetch): string[] {
  const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/v1/verify"));
}

describe("agenticTrustMiddleware", () => {
  beforeEach(() => {
    clearVerifyCache();
  });

  it("appends verified metadata and trustScore from the registry", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { body: verifiedBody("example.com", 91) },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });

    const meta = await trust.verify("https://example.com/pricing");
    expect(meta).toMatchObject({
      verified: true,
      trustScore: 91,
      domain: "example.com",
      status: "VERIFIED",
      did: "did:web:example.com",
    });
    expect(meta.securityWarning).toBeUndefined();

    const context = await trust.annotateContext({ snippet: "prices" }, "example.com");
    expect(context.snippet).toBe("prices");
    expect(context.agenticTrust).toMatchObject({ verified: true, trustScore: 91 });
    expect(context.securityWarning).toBeUndefined();

    const [called] = verifyCalls(fetchFn);
    expect(called).toContain(`${API}/v1/verify?`);
    expect(called).toContain("domain=example.com");
    expect(called).toContain("did=did%3Aweb%3Aexample.com");
    expect(verifyCalls(fetchFn)).toHaveLength(1);
  });

  it("sets a trust header and JSON metadata on fetch when verified", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { body: verifiedBody("example.com", 88) },
      "example.com/data.json": { body: { title: "catalog" } },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });

    const response = await trust.fetch("https://example.com/data.json");
    const payload = await response.json();

    expect(payload.title).toBe("catalog");
    expect(payload.agenticTrust).toMatchObject({ verified: true, trustScore: 88 });
    expect(payload.securityWarning).toBeUndefined();
    expect(JSON.parse(response.headers.get("x-agentic-trust") ?? "{}")).toEqual({
      verified: true,
      trustScore: 88,
    });
    expect(response.headers.get("x-agentic-trust-warning")).toBeNull();
  });

  it("flags unverified domains with a security warning", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": {
        body: {
          status: "UNVERIFIED",
          domain: "evil.example",
          claims: {},
          reason: "Not registered",
        },
      },
      "evil.example/page": { body: { html: "<p>hi</p>" } },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });

    const meta = await trust.verify("https://evil.example/page");
    expect(meta.verified).toBe(false);
    expect(meta.securityWarning).toBe(true);
    expect(meta.warning).toBe("Not registered");

    const response = await trust.fetch("https://evil.example/page");
    const payload = await response.json();
    expect(payload.html).toBe("<p>hi</p>");
    expect(payload.securityWarning).toBe(true);
    expect(payload.agenticTrust).toMatchObject({
      verified: false,
      securityWarning: true,
      status: "UNVERIFIED",
    });
    expect(JSON.parse(response.headers.get("x-agentic-trust") ?? "{}")).toEqual({
      verified: false,
      securityWarning: true,
    });
    expect(response.headers.get("x-agentic-trust-warning")).toBe("true");
  });

  it("fail-closes with a warning when the registry is unreachable", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { throw: new TypeError("network down") },
      "example.com/article": { body: { title: "hello" } },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });

    await expect(trust.verify("https://example.com/article")).resolves.toMatchObject({
      verified: false,
      securityWarning: true,
      domain: "example.com",
      status: "UNVERIFIED",
    });

    const response = await trust.fetch("https://example.com/article");
    const payload = await response.json();
    expect(payload.title).toBe("hello");
    expect(payload.securityWarning).toBe(true);
    expect(payload.agenticTrust.verified).toBe(false);
    expect(payload.agenticTrust.warning).toContain("network down");
  });

  it("fail-closes on registry timeout and HTTP 500 without throwing", async () => {
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const onAbort = () => reject(new DOMException("The operation timed out", "TimeoutError"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    }) as unknown as typeof fetch;

    const slow = agenticTrustMiddleware({
      fetch: hanging,
      verificationApiUrl: API,
      timeoutMs: 30,
    });
    const timed = await slow.verify("https://slow.example");
    expect(timed.verified).toBe(false);
    expect(timed.securityWarning).toBe(true);
    expect(timed.warning).toMatch(/timed out/i);

    const down = agenticTrustMiddleware({
      fetch: mockFetch({ "/v1/verify": { status: 503, body: { error: "unavailable" } } }),
      verificationApiUrl: API,
    });
    const http = await down.verify("did:web:down.example");
    expect(http).toMatchObject({
      verified: false,
      securityWarning: true,
      domain: "down.example",
      warning: "Verification API HTTP 503",
    });
  });

  it("reuses middleware cache and existing verifyDomain cache entries", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { body: verifiedBody("cached.example", 64) },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });

    await trust.verify("https://cached.example/a");
    await trust.verify("cached.example");
    expect(verifyCalls(fetchFn)).toHaveLength(1);

    const untouched = vi.fn() as unknown as typeof fetch;
    defaultCache.set(
      "verify:warm.example",
      {
        status: "VERIFIED",
        domain: "warm.example",
        claims: { did: "did:web:warm.example", trustScore: 73 },
        checkedAt: new Date().toISOString(),
      },
      60_000
    );
    const warmed = agenticTrustMiddleware({ fetch: untouched, verificationApiUrl: API });
    await expect(warmed.verify("https://warm.example/docs")).resolves.toMatchObject({
      verified: true,
      trustScore: 73,
      did: "did:web:warm.example",
    });
    expect(untouched).not.toHaveBeenCalled();
  });

  it("wraps LangChain and AI SDK tools and annotates documents", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { body: verifiedBody("docs.example", 80) },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });

    const langchainTool = {
      name: "browser",
      async invoke(input: { url: string }) {
        return { content: "page", url: input.url };
      },
    };
    const wrapped = trust.wrapTool(langchainTool);
    const toolResult = await wrapped.invoke({ url: "https://docs.example/guide" });
    expect(toolResult).toMatchObject({
      content: "page",
      agenticTrust: { verified: true, trustScore: 80 },
    });

    const aiTool = {
      async execute() {
        return "raw page";
      },
    };
    const executed = await trust.wrapTool(aiTool).execute({ href: "https://docs.example/ai" });
    expect(executed).toMatchObject({
      content: "raw page",
      agenticTrust: { verified: true, trustScore: 80 },
    });

    const docs = await trust.annotateDocuments([
      { pageContent: "hello", metadata: { source: "https://docs.example/a" } },
      { pageContent: "orphan", metadata: {} },
    ]);
    expect(docs[0]?.metadata?.agenticTrust).toMatchObject({ verified: true, trustScore: 80 });
    expect(docs[1]?.metadata?.securityWarning).toBe(true);
    expect(docs[1]?.metadata?.agenticTrust).toMatchObject({ verified: false, securityWarning: true });
  });

  it("leaves non-JSON bodies intact and still sets the trust header", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { body: verifiedBody("example.com", 70) },
      "example.com/file.txt": { text: "plain text" },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });
    const response = await trust.fetch("https://example.com/file.txt");
    expect(await response.text()).toBe("plain text");
    expect(JSON.parse(response.headers.get("x-agentic-trust") ?? "{}")).toEqual({
      verified: true,
      trustScore: 70,
    });
  });

  it("does not swallow content-fetch failures", async () => {
    const fetchFn = mockFetch({
      "/v1/verify": { body: verifiedBody("example.com") },
      "example.com/missing": { throw: new Error("socket hang up") },
    });
    const trust = agenticTrustMiddleware({ fetch: fetchFn, verificationApiUrl: API });
    await expect(trust.fetch("https://example.com/missing")).rejects.toThrow("socket hang up");
  });
});
