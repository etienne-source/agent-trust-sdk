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

const listeners = new Set<(event: AgenticTrustSecurityEvent) => void>();

/** Exact console and telemetry text for an unsigned or tampered context payload. */
export function unverifiedContextAlert(domain: string): string {
  return `[AgenticTrust Security Alert] Unverified context payload detected for ${domain}. Enable strict mode to block.`;
}

export function securityAlertEvent(domain: string, status: string): AgenticTrustSecurityEvent {
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
export function resolveEnforcementMode(options: EnforcementOptions = {}): AgenticTrustEnforcementMode {
  if (options.strict === true || options.mode === "strict" || options.failClosed === true) {
    return "strict";
  }
  return "audit";
}

/** Subscribe to in-process security alerts. The returned function removes the listener. */
export function subscribeSecurityAlerts(
  listener: (event: AgenticTrustSecurityEvent) => void
): () => void {
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
export function emitSecurityAlert(
  event: AgenticTrustSecurityEvent,
  sink?: (event: AgenticTrustSecurityEvent) => void
): void {
  console.warn(event.message);
  try {
    sink?.(event);
  } catch {
    // telemetry must not block or throw into the caller
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // a broken listener does not change audit or strict behavior
    }
  }
}
