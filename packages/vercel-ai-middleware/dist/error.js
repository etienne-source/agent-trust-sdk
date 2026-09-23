/**
 * Fail-closed message thrown when unverified or tampered `llms.txt` context
 * would otherwise be parsed or executed.
 */
export function contextPoisoningErrorMessage(domain) {
    return `[Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for ${domain}. Execution blocked.`;
}
/** Thrown when domain context is unsigned, unverified, tampered, or marked RISK. */
export class UnverifiedDomainContextError extends Error {
    code = "AGENTIC_TRUST_UNVERIFIED_CONTEXT";
    domain;
    status;
    verified = false;
    reason;
    constructor(meta) {
        const reason = meta.warning?.trim() || defaultReason(meta.status);
        super(contextPoisoningErrorMessage(meta.domain));
        this.name = "UnverifiedDomainContextError";
        this.domain = meta.domain;
        this.status = meta.status;
        this.reason = reason;
    }
}
function defaultReason(status) {
    if (status === "RISK")
        return "Domain signature failed or the domain is marked RISK";
    return "Domain is not verified or has no Trustflow signature";
}
//# sourceMappingURL=error.js.map