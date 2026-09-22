/** Thrown when domain context is unsigned, unverified, or marked RISK. */
export class UnverifiedDomainContextError extends Error {
    code = "AGENTIC_TRUST_UNVERIFIED_CONTEXT";
    domain;
    status;
    verified = false;
    reason;
    constructor(meta) {
        const reason = meta.warning?.trim() || defaultReason(meta.status);
        super(`Blocked unverified domain context for ${meta.domain}: ${reason} (${meta.status}). Refusing to parse llms.txt.`);
        this.name = "UnverifiedDomainContextError";
        this.domain = meta.domain;
        this.status = meta.status;
        this.reason = reason;
    }
}
function defaultReason(status) {
    if (status === "RISK")
        return "Domain signature failed or the domain is marked RISK";
    return "Domain is not verified or has no AgenticTrust signature";
}
//# sourceMappingURL=error.js.map