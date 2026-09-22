#!/usr/bin/env node
export { createAgenticTrustMcpServer } from "./server.js";
export { auditDomain, DEFAULT_TRUSTFLOW_API_BASE, resolveApiBase } from "./auditDomain.js";
export type { AuditDomainInput, AuditDomainResult, AuditFactor, DomainAudit } from "./auditDomain.js";
export { generateDidKeys, parseDidKeyAlgorithm, PRIVATE_KEY_SECRET_WARNING } from "./generateDidKeys.js";
export type { DidKeyAlgorithm, GenerateDidKeysInput, GenerateDidKeysResult } from "./generateDidKeys.js";
export { alignLlmsTxt, signLlmsTxt } from "./signLlmsTxt.js";
export type { SignLlmsTxtInput, SignLlmsTxtResult } from "./signLlmsTxt.js";
/**
 * Start the stdio MCP server. Cursor, Windsurf, and Claude Desktop spawn this process.
 * Logs go to stderr. stdout is reserved for the MCP protocol.
 */
export declare function main(): Promise<void>;
//# sourceMappingURL=index.d.ts.map