/** Hosted Trustflow Systems verification API. The protocol is AgenticTrust. */
export declare const DEFAULT_TRUSTFLOW_API_BASE = "https://api.trustflow.systems";
export interface AuditFactor {
    id?: string;
    label?: string;
    points?: number;
    max?: number;
    state?: string;
    detail?: string;
    [key: string]: unknown;
}
export interface DomainAudit {
    score: number | null;
    max?: number;
    headline?: string;
    brand?: string;
    factors: AuditFactor[];
    recommendations?: unknown[];
}
export interface AuditDomainResult {
    domain: string;
    status: string;
    isVerified: boolean;
    audit: DomainAudit;
    reason?: string;
    checkedAt?: string;
    claims?: Record<string, unknown>;
    /** Request URL, including the domain query. */
    source: string;
}
export interface AuditDomainInput {
    domain: string;
    /** Override the API origin. Tests pass a local base so CI never calls the network. */
    baseUrl?: string;
    fetch?: typeof fetch;
}
export declare function auditDomain(input: AuditDomainInput): Promise<AuditDomainResult>;
export declare function resolveApiBase(input?: string): string;
//# sourceMappingURL=auditDomain.d.ts.map