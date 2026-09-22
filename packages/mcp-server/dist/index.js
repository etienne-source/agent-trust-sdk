#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgenticTrustMcpServer } from "./server.js";
export { createAgenticTrustMcpServer } from "./server.js";
export { auditDomain, DEFAULT_TRUSTFLOW_API_BASE, resolveApiBase } from "./auditDomain.js";
export { generateDidKeys, parseDidKeyAlgorithm, PRIVATE_KEY_SECRET_WARNING } from "./generateDidKeys.js";
export { alignLlmsTxt, signLlmsTxt } from "./signLlmsTxt.js";
/**
 * Start the stdio MCP server. Cursor, Windsurf, and Claude Desktop spawn this process.
 * Logs go to stderr. stdout is reserved for the MCP protocol.
 */
export async function main() {
    const server = createAgenticTrustMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
function isDirectRun() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(entry)).href;
    }
    catch {
        return false;
    }
}
if (isDirectRun()) {
    main().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=index.js.map