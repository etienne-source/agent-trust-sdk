import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { auditDomain } from "./auditDomain.js";
import { generateDidKeys } from "./generateDidKeys.js";
import { signLlmsTxt } from "./signLlmsTxt.js";
const SERVER_VERSION = "0.1.0";
/**
 * Stdio MCP server for AgenticTrust.
 * Hosted audits go to Trustflow Systems (`https://api.trustflow.systems`).
 */
export function createAgenticTrustMcpServer(options = {}) {
    const server = new McpServer({
        name: "agentic-trust",
        version: SERVER_VERSION,
    });
    server.registerTool("audit_domain", {
        title: "Audit domain",
        description: "Fetch the live Trustflow Systems TrustScore and verification status for a domain (GET https://api.trustflow.systems/v1/verify?domain=). Returns status, isVerified, and the audit score with factors. Protocol: AgenticTrust. Optional baseUrl overrides the API origin (tests).",
        inputSchema: {
            domain: z.string().describe("Hostname or URL to audit, for example example.com"),
            baseUrl: z
                .string()
                .optional()
                .describe("Trustflow API base URL. Defaults to https://api.trustflow.systems"),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
            destructiveHint: false,
        },
    }, async ({ domain, baseUrl }) => runTool(async () => {
        const result = await auditDomain({ domain, baseUrl, fetch: options.fetch });
        return { ...result };
    }));
    server.registerTool("generate_did_keys", {
        title: "Generate did:web keys",
        description: "Generate an Ed25519 (default) or ES256 (P-256) key pair and a signed W3C did:web document for /.well-known/did.json. Signing uses @agentic-trust/sdk createSignedDidDocument. Returns did.json plus privateKeyPem, labeled SECRET. The private key is not written unless privateKeyPath is set.",
        inputSchema: {
            domain: z.string().describe("Hostname for did:web, for example example.com"),
            algorithm: z
                .string()
                .optional()
                .describe('Key type: "Ed25519" (default) or "ES256" (P-256)'),
            privateKeyPath: z
                .string()
                .optional()
                .describe("If set, write the SECRET private key PEM to this path (mode 0600). Otherwise the key is only returned."),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
        },
    }, async ({ domain, algorithm, privateKeyPath }) => runTool(async () => {
        const result = await generateDidKeys({ domain, algorithm, privateKeyPath });
        return { ...result };
    }));
    server.registerTool("sign_llms_txt", {
        title: "Sign llms.txt",
        description: "Sign an llms.txt manifest with the domain private key using @agentic-trust/sdk createSignedDidDocument (the same flow as @agentic-trust/cli). Input: domain, privateKeyPem, and llmsTxt or llmsTxtPath. Returns the signed did.json, the llms.txt body aligned to that did:web, and publish guidance. Does not write the private key. outputDir writes only the public artifacts.",
        inputSchema: {
            domain: z.string().describe("Hostname the manifest belongs to"),
            privateKeyPem: z
                .string()
                .describe("SECRET Ed25519 or P-256 PKCS#8 PEM. Used to sign. Not written to disk."),
            llmsTxt: z.string().optional().describe("llms.txt body. Use this or llmsTxtPath."),
            llmsTxtPath: z.string().optional().describe("Path to an llms.txt file to read."),
            outputDir: z
                .string()
                .optional()
                .describe("If set, write llms.txt, .well-known/llms.txt, and .well-known/did.json. Never the private key."),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
        },
    }, async ({ domain, privateKeyPem, llmsTxt, llmsTxtPath, outputDir }) => runTool(async () => {
        const result = await signLlmsTxt({ domain, privateKeyPem, llmsTxt, llmsTxtPath, outputDir });
        return { ...result };
    }));
    return server;
}
async function runTool(fn) {
    try {
        const structured = JSON.parse(JSON.stringify(await fn()));
        return {
            content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
            structuredContent: structured,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [{ type: "text", text: message }],
        };
    }
}
//# sourceMappingURL=server.js.map