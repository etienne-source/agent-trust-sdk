import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { auditDomain } from "./auditDomain.js";
import { generateDidKeys } from "./generateDidKeys.js";
import { signLlmsTxt } from "./signLlmsTxt.js";

export interface AgenticTrustMcpServerOptions {
  /** Used by `audit_domain`. Tests inject a mock so CI does not call the network. */
  fetch?: typeof fetch;
  /** Registry base for `audit_domain`. Defaults to `TRUSTFLOW_API_URL`, then https://api.trustflow.systems. */
  apiBase?: string;
  /**
   * Every path a tool reads or writes must be inside this directory.
   * Defaults to `AGENTIC_TRUST_MCP_ROOT`, then the process working directory.
   */
  rootDir?: string;
}

const SERVER_VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

/**
 * Stdio MCP server for Trustflow.
 * Hosted audits go to Trustflow Systems (`https://api.trustflow.systems`).
 */
export function createAgenticTrustMcpServer(options: AgenticTrustMcpServerOptions = {}): McpServer {
  const rootDir = options.rootDir ?? (process.env.AGENTIC_TRUST_MCP_ROOT?.trim() || process.cwd());
  const apiBase = options.apiBase ?? (process.env.TRUSTFLOW_API_URL?.trim() || undefined);
  const server = new McpServer({
    name: "agentic-trust",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "audit_domain",
    {
      title: "Audit domain",
      description:
        "Fetch the live Trustflow Systems TrustScore and verification status for a domain (GET https://api.trustflow.systems/v1/verify?domain=). Returns status, isVerified, and the audit score with factors. Protocol: Trustflow.",
      inputSchema: {
        domain: z.string().describe("Hostname or URL to audit, for example example.com"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async ({ domain }) =>
      runTool(async () => {
        const result = await auditDomain({ domain, baseUrl: apiBase, fetch: options.fetch });
        return { ...result };
      })
  );

  server.registerTool(
    "generate_did_keys",
    {
      title: "Generate did:web keys",
      description:
        "Generate an Ed25519 (default) or ES256 (P-256) key pair and a signed W3C did:web document for /.well-known/did.json. Signing uses @trustflow/sdk createSignedDidDocument. The private key is written to privateKeyPath (a new file inside the server root, mode 0600) and is not returned. Returns did.json and the public key.",
      inputSchema: {
        domain: z.string().describe("Hostname for did:web, for example example.com"),
        algorithm: z
          .string()
          .optional()
          .describe('Key type: "Ed25519" (default) or "ES256" (P-256)'),
        privateKeyPath: z
          .string()
          .describe(
            "New file inside the server root for the SECRET private key PEM, for example .agentic-trust/private-key.pem. An existing file is not replaced."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ domain, algorithm, privateKeyPath }) =>
      runTool(async () => {
        const result = await generateDidKeys({
          domain,
          algorithm,
          privateKeyPath,
          rootDir,
          returnPrivateKey: false,
        });
        return { ...result };
      })
  );

  server.registerTool(
    "sign_llms_txt",
    {
      title: "Sign llms.txt",
      description:
        "Sign an llms.txt manifest with the domain private key using @trustflow/sdk createSignedDidDocument (the same flow as @trustflow/cli). Input: domain, privateKeyPath, and llmsTxt or llmsTxtPath. All paths must be inside the server root. The llms.txt must not name another domain. Returns the signed did.json (it signs llmsTxtSha256), the llms.txt body aligned to that did:web, and publish guidance. The private key is read from disk and is never returned. outputDir overwrites llms.txt, .well-known/llms.txt, and .well-known/did.json there.",
      inputSchema: {
        domain: z.string().describe("Hostname the manifest belongs to"),
        privateKeyPath: z
          .string()
          .describe("File inside the server root holding the SECRET Ed25519 or P-256 PKCS#8 PEM."),
        llmsTxt: z.string().optional().describe("llms.txt body. Use this or llmsTxtPath."),
        llmsTxtPath: z.string().optional().describe("Path inside the server root to a file named llms.txt."),
        outputDir: z
          .string()
          .optional()
          .describe(
            "Directory inside the server root. Overwrites llms.txt, .well-known/llms.txt, and .well-known/did.json there. Never the private key."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ domain, privateKeyPath, llmsTxt, llmsTxtPath, outputDir }) =>
      runTool(async () => {
        const result = await signLlmsTxt({ domain, privateKeyPath, llmsTxt, llmsTxtPath, outputDir, rootDir });
        return { ...result };
      })
  );

  return server;
}

async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const structured = JSON.parse(JSON.stringify(await fn())) as Record<string, unknown>;
    return {
      content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}
