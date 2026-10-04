import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSignedDidDocument, importPublicKey, verifyDidJws, type DidDocument } from "@trustflow/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAgenticTrustMcpServer, type AgenticTrustMcpServerOptions } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function connectedClient(options: AgenticTrustMcpServerOptions = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAgenticTrustMcpServer(options);
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
  it("lists the three Trustflow tools and marks the writers as destructive", async () => {
    const { client, server } = await connectedClient();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "audit_domain",
      "generate_did_keys",
      "sign_llms_txt",
    ]);
    const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
    expect(byName.audit_domain?.annotations?.destructiveHint).toBe(false);
    expect(byName.generate_did_keys?.annotations?.destructiveHint).toBe(true);
    expect(byName.sign_llms_txt?.annotations?.destructiveHint).toBe(true);
    expect(JSON.stringify(byName.audit_domain?.inputSchema)).not.toContain("baseUrl");
    expect(JSON.stringify(byName.sign_llms_txt?.inputSchema)).not.toContain("privateKeyPem");
    await client.close();
    await server.close();
  });

  it("calls audit_domain through the server apiBase, not a tool argument", async () => {
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

    const { client, server } = await connectedClient({
      fetch: fetch as unknown as typeof fetch,
      apiBase: "https://api.example.test",
    });
    const result = await client.callTool({
      name: "audit_domain",
      arguments: { domain: "audited.example", baseUrl: "https://attacker.example" },
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

  it("writes generate_did_keys and sign_llms_txt without returning the private key", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "agentic-trust-mcp-root-"));
    const { client, server } = await connectedClient({ rootDir });
    const generated = await client.callTool({
      name: "generate_did_keys",
      arguments: { domain: "mcp.example", algorithm: "ES256", privateKeyPath: ".agentic-trust/private-key.pem" },
    });
    const keys = toolPayload(generated) as {
      did: string;
      algorithm: string;
      didJson: string;
      privateKeyPem?: string;
      secret: { label: string; writtenTo?: string };
      didDocument: DidDocument;
    };
    expect(keys.did).toBe("did:web:mcp.example");
    expect(keys.algorithm).toBe("ES256");
    expect(keys.secret.label).toBe("SECRET");
    expect(keys.privateKeyPem).toBeUndefined();
    expect(JSON.stringify(keys)).not.toContain("BEGIN PRIVATE KEY");
    expect(keys.didJson).not.toContain("PRIVATE KEY");
    expect((await verifyDidJws(keys.didDocument, (await importPublicKey(keys.didDocument))!)).ok).toBe(true);
    const pem = await readFile(path.join(rootDir, ".agentic-trust", "private-key.pem"), "utf8");
    expect(pem).toContain("BEGIN PRIVATE KEY");

    const identity = await createSignedDidDocument({ domain: "mcp.example" });
    await writeFile(path.join(rootDir, "signer.pem"), identity.privateKeyPem, "utf8");
    const signed = await client.callTool({
      name: "sign_llms_txt",
      arguments: {
        domain: "mcp.example",
        privateKeyPath: "signer.pem",
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
    expect(JSON.stringify(manifest)).not.toContain("BEGIN PRIVATE KEY");
    expect(manifest.guidance.some((line) => line.includes("api.trustflow.systems"))).toBe(true);

    const failed = await client.callTool({
      name: "audit_domain",
      arguments: { domain: "not a domain !!" },
    });
    expect(failed.isError).toBe(true);
    await client.close();
    await server.close();
  });

  it("refuses generate_did_keys and sign_llms_txt paths outside the server root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "agentic-trust-mcp-confine-"));
    const { client, server } = await connectedClient({ rootDir });
    const outside = await client.callTool({
      name: "generate_did_keys",
      arguments: { domain: "out.example", privateKeyPath: "../outside.pem" },
    });
    expect(outside.isError).toBe(true);
    expect(String(toolPayload(outside))).toMatch(/must be inside/);

    const identity = await createSignedDidDocument({ domain: "in.example" });
    await writeFile(path.join(rootDir, "key.pem"), identity.privateKeyPem, "utf8");
    const escaped = await client.callTool({
      name: "sign_llms_txt",
      arguments: {
        domain: "in.example",
        privateKeyPath: "key.pem",
        llmsTxtPath: "../llms.txt",
      },
    });
    expect(escaped.isError).toBe(true);
    expect(String(toolPayload(escaped))).toMatch(/must be inside/);
    await client.close();
    await server.close();
  });
});
