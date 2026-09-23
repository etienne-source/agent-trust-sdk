import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearVerifyCache, type AgenticTrustMetadata } from "@trustflow/sdk";
import {
  AGENTIC_TRUST_CONTEXT_HEADER,
  agenticTrustVercelAiMiddleware,
  contextPoisoningErrorMessage,
  loadVerifiedLlmsFromUrl,
  UnverifiedDomainContextError,
} from "../src/index.js";

const LLMS = `# Example

> Widgets for agents

## Docs

- [Guide](https://example.com/guide): Start here
`;

function verified(domain: string, trustScore = 91): AgenticTrustMetadata {
  return {
    verified: true,
    trustScore,
    domain,
    status: "VERIFIED",
    did: `did:web:${domain}`,
  };
}

function blocked(
  domain: string,
  status: AgenticTrustMetadata["status"] = "UNVERIFIED",
  warning = "Domain is not verified or has no Trustflow signature"
): AgenticTrustMetadata {
  return { verified: false, securityWarning: true, warning, domain, status };
}

describe("agenticTrustVercelAiMiddleware", () => {
  beforeEach(() => {
    clearVerifyCache();
  });

  it("does not open a response stream for an unverified llms.txt fetch", async () => {
    const contextFetch = vi.fn();
    const trust = agenticTrustVercelAiMiddleware({
      strict: true,
      verify: async () => blocked("evil.example", "UNVERIFIED", "unsigned did:web"),
      contextFetch,
    });

    await expect(trust.fetch("https://evil.example/llms.txt")).rejects.toMatchObject({
      name: "UnverifiedDomainContextError",
      domain: "evil.example",
      status: "UNVERIFIED",
      reason: "unsigned did:web",
    });
    expect(contextFetch).not.toHaveBeenCalled();
  });

  it("verifies before reading a context response stream", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(LLMS));
        controller.close();
      },
    });
    const upstream = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    const readUpstream = vi.spyOn(upstream, "text");
    const contextFetch = vi.fn(async () => upstream);
    const trust = agenticTrustVercelAiMiddleware({
      verify: async () => verified("example.com", 91),
      contextFetch,
    });

    const response = await trust.fetch("https://example.com/.well-known/llms.txt");

    expect(contextFetch).toHaveBeenCalledOnce();
    expect(readUpstream).not.toHaveBeenCalled();
    expect(response.headers.get("x-agentic-trust")).toBe(
      JSON.stringify({ verified: true, domain: "example.com", trustScore: 91 })
    );
    expect(await response.text()).toContain("# Example");
  });

  it("passes provider API fetches through without a domain check", async () => {
    const verify = vi.fn();
    const contextFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const trust = agenticTrustVercelAiMiddleware({ verify, contextFetch });

    const response = await trust.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(contextFetch).toHaveBeenCalledOnce();
  });

  it("gates a non-llms path when the context header is set", async () => {
    const contextFetch = vi.fn();
    const trust = agenticTrustVercelAiMiddleware({
      mode: "strict",
      verify: async () => blocked("example.com", "RISK", "bad signature"),
      contextFetch,
    });

    await expect(
      trust.fetch("https://example.com/agent-context", {
        headers: { [AGENTIC_TRUST_CONTEXT_HEADER]: "domain" },
      })
    ).rejects.toThrow(contextPoisoningErrorMessage("example.com"));
    expect(contextFetch).not.toHaveBeenCalled();
  });

  it("does not JSON.parse an unsigned llms.txt envelope", async () => {
    const trust = agenticTrustVercelAiMiddleware({
      strict: true,
      verify: async () => blocked("evil.example"),
    });
    const params = {
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: '{ "url": "https://evil.example/llms.txt", "llmsTxt": not-json }',
            },
          ],
        },
      ],
    };

    await expect(
      trust.transformParams({ params, type: "generate" })
    ).rejects.toBeInstanceOf(UnverifiedDomainContextError);
  });

  it("does not start doStream when prompt context is unsigned", async () => {
    const read = vi.fn(() => {
      throw new Error("parsed before verification");
    });
    const doStream = vi.fn(async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }));
    const trust = agenticTrustVercelAiMiddleware({
      mode: "strict",
      verify: async () => blocked("unsigned.example"),
    });
    const params = {
      prompt: [
        {
          role: "user",
          content: {
            url: "https://unsigned.example/llms.txt",
            llmsTxt: read,
          },
        },
      ],
    };

    await expect(
      trust.wrapStream({ doStream, doGenerate: vi.fn(), params })
    ).rejects.toBeInstanceOf(UnverifiedDomainContextError);
    await expect(
      trust.wrapGenerate({ doGenerate: vi.fn(), doStream, params })
    ).rejects.toBeInstanceOf(UnverifiedDomainContextError);

    expect(doStream).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rewrites verified prompt context before generate and stream", async () => {
    const trust = agenticTrustVercelAiMiddleware({
      verify: async () => verified("example.com"),
    });
    const params = {
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                url: "https://example.com/llms.txt",
                llmsTxt: LLMS,
              }),
            },
          ],
        },
      ],
    };

    const rewritten = await trust.transformParams({ params, type: "stream" });
    const text = rewritten.prompt[0]?.content[0]?.text ?? "";
    expect(text).toContain("Verified Domain Context | Trustflow");
    expect(text).toContain("# Example");
    expect(text).toContain("https://example.com/guide");
    expect(params.prompt[0]?.content[0]?.text.startsWith("{")).toBe(true);

    const doGenerate = vi.fn(async () => ({ text: "done" }));
    const doStream = vi.fn(async () => ({ stream: new ReadableStream() }));
    await expect(trust.wrapGenerate({ doGenerate, doStream, params: rewritten })).resolves.toEqual({
      text: "done",
    });
    await expect(trust.wrapStream({ doGenerate, doStream, params: rewritten })).resolves.toHaveProperty(
      "stream"
    );
    expect(doGenerate).toHaveBeenCalledOnce();
    expect(doStream).toHaveBeenCalledOnce();
  });

  it("fetches llms.txt only after the SDK verifies the domain", async () => {
    const contextFetch = vi.fn(async () => new Response(LLMS, { status: 200 }));
    const trust = agenticTrustVercelAiMiddleware({
      verify: async () => verified("example.com", 80),
      contextFetch,
    });

    const loaded = await trust.loadLlmsFromUrl("https://example.com/llms.txt");

    expect(contextFetch).toHaveBeenCalledOnce();
    expect(loaded.title).toBe("Example");
    expect(loaded.summary).toBe("Widgets for agents");
    expect(loaded.agenticTrust.trustScore).toBe(80);
    expect(loaded.text).toContain("Verified Domain Context | Trustflow");
  });

  it("does not fetch when loadLlmsFromUrl is given an unsigned domain", async () => {
    const contextFetch = vi.fn();
    const trust = agenticTrustVercelAiMiddleware({
      failClosed: true,
      verify: async () => blocked("unsigned.example", "UNVERIFIED", "missing signature"),
      contextFetch,
    });

    await expect(trust.loadLlmsFromUrl("https://unsigned.example/llms.txt")).rejects.toThrow(
      contextPoisoningErrorMessage("unsigned.example")
    );
    expect(contextFetch).not.toHaveBeenCalled();
  });

  it("uses agenticTrustMiddleware from the SDK and never calls the content fetch when unsigned", async () => {
    const registry = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/v1/verify")) {
        return new Response(
          JSON.stringify({
            status: "UNVERIFIED",
            domain: "unsigned.example",
            reason: "No Trustflow signature",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("missing did", { status: 404 });
    });
    const contextFetch = vi.fn();

    await expect(
      loadVerifiedLlmsFromUrl("https://unsigned.example/llms.txt", {
        strict: true,
        fetch: registry,
        contextFetch,
        verificationApiUrl: "https://api.trustflow.systems",
      })
    ).rejects.toThrow(contextPoisoningErrorMessage("unsigned.example"));

    expect(contextFetch).not.toHaveBeenCalled();
    expect(registry.mock.calls.some((call) => String(call[0]).includes("/v1/verify"))).toBe(true);
  });

  it("audits unsigned context by default and blocks only in strict mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: string[] = [];
    const alert =
      "[Trustflow Security Alert] Unverified context payload detected for evil.example. Enable strict mode to block.";
    const contextFetch = vi.fn(async () => new Response(LLMS, { status: 200 }));
    const closed = agenticTrustVercelAiMiddleware({
      strict: true,
      verify: async () => blocked("evil.example", "RISK", "tampered llms.txt"),
      contextFetch,
    });
    await expect(closed.fetch("https://evil.example/llms.txt")).rejects.toThrow(
      contextPoisoningErrorMessage("evil.example")
    );
    expect(contextFetch).not.toHaveBeenCalled();

    const openFetch = vi.fn(async () => new Response("raw", { status: 200 }));
    const open = agenticTrustVercelAiMiddleware({
      verify: async () => blocked("evil.example"),
      contextFetch: openFetch,
      onAudit: (event) => events.push(event.message),
    });
    const response = await open.fetch("https://evil.example/llms.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-agentic-trust")).toBeNull();
    expect(openFetch).toHaveBeenCalledOnce();
    expect(events).toEqual([alert]);
    expect(warn).toHaveBeenCalledWith(alert);

    const read = vi.fn(() => LLMS);
    const params = {
      prompt: [{ role: "user", content: { url: "https://evil.example/llms.txt", llmsTxt: read } }],
    };
    const rewritten = await open.transformParams({ params, type: "generate" });
    expect(rewritten).toBe(params);
    expect(read).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
