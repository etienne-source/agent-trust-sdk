import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSignedDidDocument, importPublicKey, verifyDidJws, type DidDocument } from "@trustflow/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAgenticTrustMcpServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function connectedClient(fetchImpl?: typeof fetch) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAgenticTrustMcpServer(fetchImpl ? { fetch: fetchImpl } : {});
  await server.connect(serverTransport);
  const client = new Client({ name: "agentic-trust-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

function toolPayload(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }): unknown {
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  if (result.isError) return text;
  return JSON.parse(text) as unknown;
}

describe("MCP server", () => {
  it("lists the three AgenticTrust tools", async () => {
    const { client, server } = await connectedClient();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "audit_domain",
      "generate_did_keys",
      "sign_llms_txt",
    ]);
    await client.close();
    await server.close();
  });

  it("calls audit_domain through stdio-equivalent transport with a mocked fetch", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe("https://api.example.test/v1/verify?domain=audited.example");
      return jsonResponse({
        status: "VERIFIED",
        domain: "audited.example",
        audit: {
          score: 80,
          max: 100,
          factors: [{ id: "signed", label: "Signed claims", points: 25, max: 25, state: "pass" }],
        },
      });
    });

    const { client, server } = await connectedClient(fetch as unknown as typeof fetch);
    const result = await client.callTool({
      name: "audit_domain",
      arguments: { domain: "audited.example", baseUrl: "https://api.example.test" },
    });
    expect(result.isError).toBeFalsy();
    const payload = toolPayload(result) as {
      status: string;
      isVerified: boolean;
      audit: { score: number; factors: Array<{ id: string }> };
    };
    expect(payload.status).toBe("VERIFIED");
    expect(payload.isVerified).toBe(true);
    expect(payload.audit.score).toBe(80);
    expect(payload.audit.factors[0]?.id).toBe("signed");
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.close();
    await server.close();
  });

  it("calls generate_did_keys and sign_llms_txt without writing secrets", async () => {
    const { client, server } = await connectedClient();
    const generated = await client.callTool({
      name: "generate_did_keys",
      arguments: { domain: "mcp.example", algorithm: "ES256" },
    });
    const keys = toolPayload(generated) as {
      did: string;
      algorithm: string;
      didJson: string;
      privateKeyPem: string;
      secret: { label: string };
      didDocument: DidDocument;
    };
    expect(keys.did).toBe("did:web:mcp.example");
    expect(keys.algorithm).toBe("ES256");
    expect(keys.secret.label).toBe("SECRET");
    expect(keys.privateKeyPem).toContain("PRIVATE KEY");
    expect(keys.didJson).not.toContain("PRIVATE KEY");
    expect((await verifyDidJws(keys.didDocument, (await importPublicKey(keys.didDocument))!)).ok).toBe(true);

    const identity = await createSignedDidDocument({ domain: "mcp.example" });
    const signed = await client.callTool({
      name: "sign_llms_txt",
      arguments: {
        domain: "mcp.example",
        privateKeyPem: identity.privateKeyPem,
        llmsTxt: "# MCP\n> tools\n\nDomain: mcp.example\n",
      },
    });
    const manifest = toolPayload(signed) as {
      did: string;
      llmsTxt: string;
      didJson: string;
      guidance: string[];
    };
    expect(manifest.did).toBe("did:web:mcp.example");
    expect(manifest.llmsTxt).toContain("- DID: did:web:mcp.example");
    expect(manifest.didJson).not.toContain("PRIVATE KEY");
    expect(manifest.llmsTxt).not.toContain(identity.privateKeyPem);
    expect(manifest.guidance.some((line) => line.includes("api.trustflow.systems"))).toBe(true);

    const failed = await client.callTool({
      name: "audit_domain",
      arguments: { domain: "not a domain !!", baseUrl: "https://api.example.test" },
    });
    expect(failed.isError).toBe(true);
    await client.close();
    await server.close();
  });
});
