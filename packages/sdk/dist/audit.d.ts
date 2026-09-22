/**
 * Audit-mode signal for unsigned domain context.
 * No network call. Listeners run in-process.
 */
export type AgenticTrustEnforcementMode = "audit" | "strict";
export interface AgenticTrustSecurityEvent {
    type: "agentic_trust.security_alert";
    level: "warn";
    message: string;
    domain: string;
    status: string;
    mode: "audit";
}
export interface EnforcementOptions {
    /** `"audit"` (default) warns. `"strict"` throws the context-poisoning error. */
    mode?: AgenticTrustEnforcementMode;
    /** `true` selects strict mode. */
    strict?: boolean;
    /**
     * `true` selects strict mode.
     * Omitted or `false` stays in audit mode. This is no longer fail-closed by default.
     */
    failClosed?: boolean;
}
/** Exact console and telemetry text for an unsigned or tampered context payload. */
export declare function unverifiedContextAlert(domain: string): string;
export declare function securityAlertEvent(domain: string, status: string): AgenticTrustSecurityEvent;
/**
 * Strict wins when any opt-in is set: `strict: true`, `mode: "strict"`, or `failClosed: true`.
 * Otherwise the mode is audit, including when those fields are omitted.
 */
export declare function resolveEnforcementMode(options?: EnforcementOptions): AgenticTrustEnforcementMode;
/** Subscribe to in-process security alerts. The returned function removes the listener. */
export declare function subscribeSecurityAlerts(listener: (event: AgenticTrustSecurityEvent) => void): () => void;
/**
 * Structured console warning plus a lightweight telemetry event.
 * The warning text and `event.message` are the same alert string.
 * Listeners that throw are ignored so telemetry cannot change enforcement.
 */
export declare function emitSecurityAlert(event: AgenticTrustSecurityEvent, sink?: (event: AgenticTrustSecurityEvent) => void): void;
//# sourceMappingURL=audit.d.ts.map