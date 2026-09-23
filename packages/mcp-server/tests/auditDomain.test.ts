import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { auditDomain, DEFAULT_TRUSTFLOW_API_BASE } from "../src/auditDomain.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("auditDomain", () => {
  it("reads status, isVerified, and audit score/factors from the Trustflow verify API", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        status: "VERIFIED",
        domain: "example.com",
        checkedAt: "2026-09-22T18:00:00.000Z",
        claims: { did: "did:web:example.com", llmsTxtPresent: true },
        audit: {
          score: 100,
          max: 100,
          headline: "100/100",
          brand: "Trustflow Domain Audit",
          factors: [
            { id: "did", label: "Public identity file", points: 20, max: 20, state: "pass", detail: "did.json verified" },
            { id: "signed", label: "Signed claims", points: 25, max: 25, state: "pass" },
          ],
          recommendations: [],
        },
      })
    );

    const result = await auditDomain({
      domain: "https://Example.COM/path",
      baseUrl: "https://registry.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://registry.test/v1/verify?domain=example.com"
    );
    expect(result.domain).toBe("example.com");
    expect(result.status).toBe("VERIFIED");
    expect(result.isVerified).toBe(true);
    expect(result.audit.score).toBe(100);
    expect(result.audit.max).toBe(100);
    expect(result.audit.factors).toHaveLength(2);
    expect(result.audit.factors[0]).toMatchObject({ id: "did", points: 20, state: "pass" });
    expect(result.checkedAt).toBe("2026-09-22T18:00:00.000Z");
    expect(result.source).toBe("https://registry.test/v1/verify?domain=example.com");
  });

  it("defaults to api.trustflow.systems and derives isVerified from status", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        status: "UNVERIFIED",
        domain: "missing.example",
        reason: "Domain not in registry",
        audit: { score: 0, max: 100, factors: [{ id: "registry", points: 0, state: "fail" }] },
      })
    );

    const result = await auditDomain({
      domain: "missing.example",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${DEFAULT_TRUSTFLOW_API_BASE}/v1/verify?domain=missing.example`
    );
    expect(DEFAULT_TRUSTFLOW_API_BASE).toBe("https://api.trustflow.systems");
    expect(result.isVerified).toBe(false);
    expect(result.status).toBe("UNVERIFIED");
    expect(result.audit.score).toBe(0);
    expect(result.audit.factors[0]).toMatchObject({ id: "registry", state: "fail" });
    expect(result.reason).toBe("Domain not in registry");
  });

  it("honors an explicit isVerified flag and a trustScore outside audit", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        status: "verified",
        isVerified: true,
        trustScore: 88,
        domain: "scored.example",
      })
    );
    const result = await auditDomain({
      domain: "scored.example",
      baseUrl: "http://127.0.0.1:9/v1/verify",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("http://127.0.0.1:9/v1/verify?domain=scored.example");
    expect(result.isVerified).toBe(true);
    expect(result.audit.score).toBe(88);
    expect(result.audit.factors).toEqual([]);
  });

  it("fails closed on HTTP errors without calling a second host", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: "nope" }, 503));
    await expect(
      auditDomain({
        domain: "down.example",
        baseUrl: "https://registry.test",
        fetch: fetch as unknown as typeof globalThis.fetch,
      })
    ).rejects.toThrow(/HTTP 503/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not use the network when fetch is injected", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("blocked");
    });
    await expect(
      auditDomain({
        domain: "offline.example",
        fetch: fetch as unknown as typeof globalThis.fetch,
      })
    ).rejects.toThrow(/blocked/);
  });
});

describe("package README", () => {
  it("documents the stdio config and the GitHub install path", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain("github:etienne-source/agent-trust-sdk");
    expect(readme).toContain("@trustflow/mcp-server");
    expect(readme).toContain("npx");
    expect(readme).toContain("claude_desktop_config.json");
    expect(readme).toContain("cursor.json");
    expect(readme).toContain("https://api.trustflow.systems");
    expect(readme).not.toMatch(/npm install trustflow-sdk/);
  });
});
