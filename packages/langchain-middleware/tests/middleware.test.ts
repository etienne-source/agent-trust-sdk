import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearVerifyCache, type AgenticTrustMetadata } from "@trustflow/sdk";
import {
  agenticTrustLangChainMiddleware,
  contextPoisoningErrorMessage,
  loadVerifiedLlmsContext,
  UnverifiedDomainContextError,
} from "../src/index.js";

const LLMS = `# Example

> Widgets for agents

Hours are 9 to 5.

## Docs

- [Guide](https://example.com/guide): Start here
`;

function verified(domain: string, trustScore = 90): AgenticTrustMetadata {
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
  warning = "Domain is not verified or has no AgenticTrust signature"
): AgenticTrustMetadata {
  return {
    verified: false,
    securityWarning: true,
    warning,
    domain,
    status,
  };
}

function body(domain: string) {
  return () => {
    throw new Error(`parsed ${domain} before verification`);
  };
}

describe("agenticTrustLangChainMiddleware", () => {
  beforeEach(() => {
    clearVerifyCache();
  });

  it("parses llms.txt only after the SDK reports the domain verified", async () => {
    const read = vi.fn(() => LLMS);
    const trust = agenticTrustLangChainMiddleware({
      verify: async () => verified("example.com"),
    });

    const context = await trust.loadLlmsContext({
      target: "https://example.com/llms.txt",
      content: read,
    });

    expect(read).toHaveBeenCalledOnce();
    expect(context.domain).toBe("example.com");
    expect(context.title).toBe("Example");
    expect(context.summary).toBe("Widgets for agents");
    expect(context.details).toBe("Hours are 9 to 5.");
    expect(context.sections[0]?.links[0]).toMatchObject({
      title: "Guide",
      url: "https://example.com/guide",
    });
    expect(context.text).toContain("Verified by AgenticTrust | trustflow.systems");
    expect(context.agenticTrust.trustScore).toBe(90);
  });

  it("blocks unsigned context before the body is read", async () => {
    const read = vi.fn(body("unsigned.example"));
    const trust = agenticTrustLangChainMiddleware({
      strict: true,
      verify: async () => blocked("unsigned.example", "UNVERIFIED", "No AgenticTrust signature"),
    });

    await expect(
      trust.loadLlmsContext({
        target: "https://unsigned.example/llms.txt",
        content: read,
      })
    ).rejects.toThrow(UnverifiedDomainContextError);

    await expect(
      trust.loadLlmsContext({
        target: "https://unsigned.example/llms.txt",
        content: read,
      })
    ).rejects.toThrow(contextPoisoningErrorMessage("unsigned.example"));

    expect(read).not.toHaveBeenCalled();
  });

  it("blocks RISK domains before parsing a document body", async () => {
    const read = vi.fn(body("risk.example"));
    const trust = agenticTrustLangChainMiddleware({
      mode: "strict",
      verify: async () => blocked("risk.example", "RISK", "DID signature did not verify"),
    });
    const document = {
      pageContent: read,
      metadata: { source: "https://risk.example/llms.txt" },
    };

    await expect(trust.beforeModel({ messages: [document] })).rejects.toMatchObject({
      domain: "risk.example",
      status: "RISK",
      code: "AGENTIC_TRUST_UNVERIFIED_CONTEXT",
    });
    expect(read).not.toHaveBeenCalled();
    expect(document.pageContent).toBe(read);
  });

  it("does not parse an earlier payload when a later domain is unverified", async () => {
    const first = vi.fn(body("good.example"));
    const second = vi.fn(body("bad.example"));
    const trust = agenticTrustLangChainMiddleware({
      strict: true,
      verify: async (target) =>
        target.includes("good.example") ? verified("good.example") : blocked("bad.example"),
    });

    await expect(
      trust.beforeModel({
        messages: [
          { role: "user", content: { url: "https://good.example/llms.txt", llmsTxt: first } },
          { role: "user", content: { url: "https://bad.example/llms.txt", llmsTxt: second } },
        ],
      })
    ).rejects.toBeInstanceOf(UnverifiedDomainContextError);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("replaces a verified message payload and leaves the original message intact", async () => {
    const content = { url: "https://example.com/llms.txt", llmsTxt: LLMS };
    const message = { role: "user", content };
    const trust = agenticTrustLangChainMiddleware({
      verify: async () => verified("example.com", 88),
    });

    const update = await trust.beforeModel({ messages: [message] });

    expect(message.content).toBe(content);
    expect(content.llmsTxt).toBe(LLMS);
    const rewritten = update?.messages[0] as { content: { llmsTxt: string } };
    expect(rewritten.content.llmsTxt).toContain("# Example");
    expect(rewritten.content.llmsTxt).toContain("trustScore: 88");
    expect(rewritten.content.llmsTxt).not.toContain("https://example.com/llms.txt#");
  });

  it("does not JSON.parse an unsigned llms.txt envelope in a message", async () => {
    const trust = agenticTrustLangChainMiddleware({
      failClosed: true,
      verify: async () => blocked("evil.example"),
    });

    await expect(
      trust.beforeModel({
        messages: [
          {
            role: "user",
            content: '{ "url": "https://evil.example/llms.txt", "llmsTxt": not-json }',
          },
        ],
      })
    ).rejects.toBeInstanceOf(UnverifiedDomainContextError);
  });

  it("rejects an unverified llms.txt tool call before the tool runs", async () => {
    const handler = vi.fn();
    const trust = agenticTrustLangChainMiddleware({
      strict: true,
      verify: async () => blocked("evil.example"),
    });

    await expect(
      trust.wrapToolCall(
        { toolCall: { name: "fetch_llms", args: { url: "https://evil.example/llms.txt" } } },
        handler
      )
    ).rejects.toThrow(contextPoisoningErrorMessage("evil.example"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("verifies a did:web tool target, then runs the tool", async () => {
    const seen: string[] = [];
    const handler = vi.fn(async () => "ok");
    const trust = agenticTrustLangChainMiddleware({
      verify: async (target) => {
        seen.push(target);
        return verified("example.com");
      },
    });

    await expect(
      trust.wrapToolCall(
        { toolCall: { name: "load_context", args: { url: "did:web:example.com" } } },
        handler
      )
    ).resolves.toBe("ok");

    expect(seen).toEqual(["did:web:example.com"]);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("leaves ordinary tool calls and model requests alone", async () => {
    const verify = vi.fn(async () => verified("example.com"));
    const trust = agenticTrustLangChainMiddleware({ verify });
    const handler = vi.fn(async (request: unknown) => request);

    await trust.wrapToolCall({ toolCall: { name: "calc", args: { expression: "1+1" } } }, handler);
    await trust.wrapModelCall({ messages: [{ role: "user", content: "Hello" }] }, handler);

    expect(verify).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not call the model when prompt context is unsigned", async () => {
    const handler = vi.fn();
    const read = vi.fn(body("unsigned.example"));
    const trust = agenticTrustLangChainMiddleware({
      mode: "strict",
      verify: async () => blocked("unsigned.example"),
    });

    await expect(
      trust.wrapModelCall(
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "" }],
              pageContent: read,
              metadata: { source: "https://unsigned.example/.well-known/llms.txt" },
            },
          ],
        },
        handler
      )
    ).rejects.toBeInstanceOf(UnverifiedDomainContextError);

    expect(handler).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("uses agenticTrustMiddleware from the SDK when verify is not injected", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/v1/verify")) {
        return new Response(
          JSON.stringify({
            status: "VERIFIED",
            domain: "example.com",
            claims: { did: "did:web:example.com", trustScore: 77 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("missing did", { status: 404 });
    });

    const context = await loadVerifiedLlmsContext(
      { target: "https://example.com/llms.txt", content: () => LLMS },
      { fetch: fetchImpl, verificationApiUrl: "https://api.trustflow.systems" }
    );

    expect(context.agenticTrust).toMatchObject({
      verified: true,
      domain: "example.com",
      trustScore: 77,
    });
    expect(context.title).toBe("Example");
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/v1/verify"))).toBe(true);
    expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("audits unsigned context by default and blocks only in strict mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: string[] = [];
    const read = vi.fn(body("unsigned.example"));
    const alert =
      "[AgenticTrust Security Alert] Unverified context payload detected for unsigned.example. Enable strict mode to block.";
    const audit = agenticTrustLangChainMiddleware({
      verify: async () => blocked("unsigned.example", "RISK", "tampered signature"),
      onAudit: (event) => events.push(event.message),
    });

    const loaded = await audit.loadLlmsContext({
      target: "https://unsigned.example/llms.txt",
      content: read,
    });
    expect(loaded.text).toBe("");
    expect(loaded.agenticTrust.verified).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(events).toEqual([alert]);
    expect(warn).toHaveBeenCalledWith(alert);

    const handler = vi.fn(async () => "ran");
    await expect(
      audit.wrapToolCall(
        { toolCall: { name: "fetch_llms", args: { url: "https://unsigned.example/llms.txt", llmsTxt: read } } },
        handler
      )
    ).resolves.toBe("ran");
    expect(read).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();

    const closed = agenticTrustLangChainMiddleware({
      strict: true,
      verify: async () => blocked("unsigned.example", "RISK", "tampered signature"),
    });
    await expect(
      closed.loadLlmsContext({
        target: "https://unsigned.example/llms.txt",
        content: read,
      })
    ).rejects.toThrow(
      "[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for unsigned.example. Execution blocked."
    );
    expect(read).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
