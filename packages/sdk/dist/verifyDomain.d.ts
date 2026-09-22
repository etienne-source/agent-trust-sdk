import type { EndpointInspectionResult, VerifyDomainOptions, VerifyResult } from "./types.js";
/**
 * Verify a domain against the **AgenticTrust** protocol (`did:web` DID signature + JWS),
 * with central API fallback. Cache-first path targets <50ms on repeat lookups.
 *
 * Import from `@agentic-trust/sdk`. The hosted registry is Trustflow Systems
 * (`https://api.trustflow.systems`).
 */
export declare function verifyDomain(domainUrl: string, options?: VerifyDomainOptions): Promise<VerifyResult>;
/**
 * AgenticTrust SDK gate for MCP / tool endpoints before agent execution.
 * Verifies the owning domain's DID signature and requires HTTPS.
 */
export declare function inspectEndpointBeforeExecution(endpoint: string, options?: VerifyDomainOptions): Promise<EndpointInspectionResult>;
export declare function clearVerifyCache(): void;
//# sourceMappingURL=verifyDomain.d.ts.map