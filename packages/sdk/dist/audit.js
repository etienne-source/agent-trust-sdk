/**
 * Audit-mode signal for unsigned domain context.
 * No network call. Listeners run in-process.
 */
const listeners = new Set();
/** Exact console and telemetry text for an unsigned or tampered context payload. */
export function unverifiedContextAlert(domain) {
    return `[AgenticTrust Security Alert] Unverified context payload detected for ${domain}. Enable strict mode to block.`;
}
export function securityAlertEvent(domain, status) {
    return {
        type: "agentic_trust.security_alert",
        level: "warn",
        message: unverifiedContextAlert(domain),
        domain,
        status,
        mode: "audit",
    };
}
/**
 * Strict wins when any opt-in is set: `strict: true`, `mode: "strict"`, or `failClosed: true`.
 * Otherwise the mode is audit, including when those fields are omitted.
 */
export function resolveEnforcementMode(options = {}) {
    if (options.strict === true || options.mode === "strict" || options.failClosed === true) {
        return "strict";
    }
    return "audit";
}
/** Subscribe to in-process security alerts. The returned function removes the listener. */
export function subscribeSecurityAlerts(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
/**
 * Structured console warning plus a lightweight telemetry event.
 * The warning text and `event.message` are the same alert string.
 * Listeners that throw are ignored so telemetry cannot change enforcement.
 */
export function emitSecurityAlert(event, sink) {
    console.warn(event.message);
    try {
        sink?.(event);
    }
    catch {
        // telemetry must not block or throw into the caller
    }
    for (const listener of listeners) {
        try {
            listener(event);
        }
        catch {
            // a broken listener does not change audit or strict behavior
        }
    }
}
//# sourceMappingURL=audit.js.map