import type { AgenticTrustMetadata } from "@agentic-trust/sdk";
/**
 * Fail-closed message thrown when unverified or tampered `llms.txt` context
 * would otherwise be parsed or executed.
 */
export declare function contextPoisoningErrorMessage(domain: string): string;
/** Thrown when domain context is unsigned, unverified, tampered, or marked RISK. */
export declare class UnverifiedDomainContextError extends Error {
    readonly code: "AGENTIC_TRUST_UNVERIFIED_CONTEXT";
    readonly domain: string;
    readonly status: string;
    readonly verified: false;
    readonly reason: string;
    constructor(meta: Pick<AgenticTrustMetadata, "domain" | "status" | "warning">);
}
//# sourceMappingURL=error.d.ts.map