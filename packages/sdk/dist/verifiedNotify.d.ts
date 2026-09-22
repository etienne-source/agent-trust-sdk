import type { VerificationStatus } from "./types.js";
/** Env var for the HTTPS webhook. This hook never reads X or Twitter credentials. */
export declare const VERIFIED_NOTIFY_ENV = "VERIFIED_NOTIFY_WEBHOOK";
/** Registry score that counts as a complete verification (100 of 100). */
export declare const VERIFIED_SCORE_COMPLETE = 100;
export interface VerifiedDomainNotice {
    /** Hostname or URL. Normalized before it is sent. */
    domain: string;
    status: VerificationStatus | string;
    /** Points awarded. The hook posts only when this is 100. */
    score: number;
    /** Denominator. Defaults to 100. Any other maximum is not a complete verification. */
    maxScore?: number;
    checkedAt?: string;
}
export interface NotifyVerifiedDomainOptions {
    /**
     * Webhook URL. When omitted, `VERIFIED_NOTIFY_WEBHOOK` is used.
     * Pass an empty string to force the unset path in tests.
     */
    webhookUrl?: string;
    fetch?: typeof fetch;
    logger?: {
        info: (message: string) => void;
        warn: (message: string) => void;
    };
    timeoutMs?: number;
}
export interface VerifiedNotifyPayload {
    event: "agentic_trust.domain.verified";
    protocol: "AgenticTrust";
    registry: "Trustflow Systems";
    domain: string;
    status: "VERIFIED";
    score: 100;
    maxScore: 100;
    checkedAt: string;
}
export type NotifyVerifiedReason = "sent" | "not_complete" | "webhook_unset" | "webhook_rejected" | "request_failed";
export interface NotifyVerifiedDomainResult {
    sent: boolean;
    reason: NotifyVerifiedReason;
    statusCode?: number;
}
/** True only for status VERIFIED at 100/100. The caller supplies the score; this function does not query the registry. */
export declare function isCompleteVerification(notice: VerifiedDomainNotice): boolean;
export declare function buildVerifiedNotifyPayload(notice: VerifiedDomainNotice, now?: Date): VerifiedNotifyPayload;
/**
 * Tell an operator webhook that a domain was reported at 100/100 VERIFIED.
 * No-ops unless both the status and the score are complete. Posts JSON to
 * `VERIFIED_NOTIFY_WEBHOOK` (or `webhookUrl`). Does not post to X.
 */
export declare function notifyVerifiedDomain(notice: VerifiedDomainNotice, options?: NotifyVerifiedDomainOptions): Promise<NotifyVerifiedDomainResult>;
//# sourceMappingURL=verifiedNotify.d.ts.map