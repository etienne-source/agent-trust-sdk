import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export interface AgenticTrustMcpServerOptions {
    /** Used by `audit_domain`. Tests inject a mock so CI does not call the network. */
    fetch?: typeof fetch;
}
/**
 * Stdio MCP server for Trustflow.
 * Hosted audits go to Trustflow Systems (`https://api.trustflow.systems`).
 */
export declare function createAgenticTrustMcpServer(options?: AgenticTrustMcpServerOptions): McpServer;
//# sourceMappingURL=server.d.ts.map