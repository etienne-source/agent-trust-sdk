import { assertHttpsEndpoint, normalizeDomain } from "./tls.js";
/** Env var for the HTTPS webhook. This hook never reads X or Twitter credentials. */
export const VERIFIED_NOTIFY_ENV = "VERIFIED_NOTIFY_WEBHOOK";
/** Registry score that counts as a complete verification (100 of 100). */
export const VERIFIED_SCORE_COMPLETE = 100;
const BLOCKED_WEBHOOK_SUFFIXES = ["x.com", "twitter.com"];
/** True only for status VERIFIED at 100/100. The caller supplies the score; this function does not query the registry. */
export function isCompleteVerification(notice) {
    const max = notice.maxScore ?? VERIFIED_SCORE_COMPLETE;
    return (String(notice.status).toUpperCase() === "VERIFIED" &&
        notice.score === VERIFIED_SCORE_COMPLETE &&
        max === VERIFIED_SCORE_COMPLETE);
}
export function buildVerifiedNotifyPayload(notice, now = new Date()) {
    if (!isCompleteVerification(notice)) {
        throw new Error("Refusing to build a verified-domain payload for an incomplete score.");
    }
    return {
        event: "agentic_trust.domain.verified",
        protocol: "AgenticTrust",
        registry: "Trustflow Systems",
        domain: normalizeDomain(notice.domain),
        status: "VERIFIED",
        score: VERIFIED_SCORE_COMPLETE,
        maxScore: VERIFIED_SCORE_COMPLETE,
        checkedAt: notice.checkedAt ?? now.toISOString(),
    };
}
function webhookHostBlocked(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    return BLOCKED_WEBHOOK_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
/**
 * Tell an operator webhook that a domain was reported at 100/100 VERIFIED.
 * No-ops unless both the status and the score are complete. Posts JSON to
 * `VERIFIED_NOTIFY_WEBHOOK` (or `webhookUrl`). Does not post to X.
 */
export async function notifyVerifiedDomain(notice, options = {}) {
    const logger = options.logger ?? console;
    if (!isCompleteVerification(notice)) {
        return { sent: false, reason: "not_complete" };
    }
    const domain = normalizeDomain(notice.domain);
    const configured = options.webhookUrl !== undefined ? options.webhookUrl : process.env[VERIFIED_NOTIFY_ENV];
    const webhook = (configured ?? "").trim();
    if (!webhook) {
        logger.info(`[Trustflow] ${domain} is 100/100 VERIFIED. ${VERIFIED_NOTIFY_ENV} is unset, so no webhook was sent. Sharing on X is a separate explicit step and is not performed by this hook.`);
        return { sent: false, reason: "webhook_unset" };
    }
    let url;
    try {
        url = new URL(webhook);
    }
    catch {
        logger.warn(`[Trustflow] ${VERIFIED_NOTIFY_ENV} is not a URL. No notification was sent.`);
        return { sent: false, reason: "webhook_rejected" };
    }
    if (!assertHttpsEndpoint(webhook) ||
        url.username ||
        url.password ||
        webhookHostBlocked(url.hostname)) {
        logger.warn(`[Trustflow] Refusing webhook host ${url.hostname}. Notifications are HTTPS webhooks you configure. This hook does not post to X.`);
        return { sent: false, reason: "webhook_rejected" };
    }
    const payload = buildVerifiedNotifyPayload(notice);
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    try {
        const response = await fetchFn(url.toString(), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json",
                "user-agent": "agentic-trust-verified-notify",
            },
            body: JSON.stringify(payload),
            redirect: "error",
            signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        if (!response.ok) {
            logger.warn(`[Trustflow] Verified-domain webhook for ${payload.domain} returned ${response.status}.`);
            return { sent: false, reason: "request_failed", statusCode: response.status };
        }
        logger.info(`[Trustflow] Notified ${url.hostname} that ${payload.domain} is 100/100 VERIFIED.`);
        return { sent: true, reason: "sent", statusCode: response.status };
    }
    catch {
        logger.warn(`[Trustflow] Verified-domain webhook for ${domain} failed before a response.`);
        return { sent: false, reason: "request_failed" };
    }
}
//# sourceMappingURL=verifiedNotify.js.map