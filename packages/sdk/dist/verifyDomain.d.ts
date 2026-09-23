import type { EndpointInspectionResult, VerifyDomainOptions, VerifyResult } from "./types.js";
/**
 * Verify a domain against the **AgenticTrust** protocol (`did:web` DID signature + JWS),
 * with central API fallback. A warm in-memory cache hit stays under 5ms.
 *
 * Import from `@trustflow/sdk`. The hosted registry is Trustflow Systems
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