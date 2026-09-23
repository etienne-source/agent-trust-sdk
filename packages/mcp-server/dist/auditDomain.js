import { normalizeDomain } from "@trustflow/sdk";
/** Hosted Trustflow Systems verification API. The protocol is Trustflow. */
export const DEFAULT_TRUSTFLOW_API_BASE = "https://api.trustflow.systems";
export async function auditDomain(input) {
    const domain = normalizeDomain(input.domain);
    const apiBase = resolveApiBase(input.baseUrl);
    const source = `${apiBase}/v1/verify?domain=${encodeURIComponent(domain)}`;
    const fetchFn = input.fetch ?? globalThis.fetch;
    let response;
    try {
        response = await fetchFn(source, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "request failed";
        throw new Error(`Trustflow verify request failed: ${message}`);
    }
    const text = await response.text();
    let parsed;
    if (text) {
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new Error(`Trustflow verify returned invalid JSON (HTTP ${response.status})`);
        }
    }
    if (!response.ok) {
        const detail = typeof parsed === "string" ? parsed : text.slice(0, 300);
        throw new Error(`Trustflow verify HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const body = asRecord(parsed);
    if (!body) {
        throw new Error("Trustflow verify returned an unexpected payload");
    }
    const status = typeof body.status === "string" && body.status.trim() ? body.status : "UNVERIFIED";
    const auditRecord = asRecord(body.audit);
    const claims = asRecord(body.claims);
    const score = readScore(body, auditRecord, claims);
    const factors = readFactors(auditRecord);
    const result = {
        domain: typeof body.domain === "string" && body.domain.trim() ? body.domain : domain,
        status,
        isVerified: readIsVerified(body, status),
        audit: {
            score,
            factors,
        },
        source,
    };
    const max = readNumber(auditRecord?.max);
    if (max !== undefined)
        result.audit.max = max;
    if (typeof auditRecord?.headline === "string")
        result.audit.headline = auditRecord.headline;
    if (typeof auditRecord?.brand === "string")
        result.audit.brand = auditRecord.brand;
    if (Array.isArray(auditRecord?.recommendations)) {
        result.audit.recommendations = auditRecord.recommendations;
    }
    if (typeof body.reason === "string")
        result.reason = body.reason;
    if (typeof body.checkedAt === "string")
        result.checkedAt = body.checkedAt;
    if (claims)
        result.claims = claims;
    return result;
}
export function resolveApiBase(input) {
    const raw = (input ?? "").trim();
    if (!raw)
        return DEFAULT_TRUSTFLOW_API_BASE;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`Invalid Trustflow API base URL: ${input}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Trustflow API base URL must use http or https");
    }
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/v1/verify"))
        path = path.slice(0, -"/v1/verify".length);
    const suffix = path === "/" ? "" : path;
    return `${url.origin}${suffix}`;
}
function readIsVerified(body, status) {
    if (typeof body.isVerified === "boolean")
        return body.isVerified;
    if (typeof body.verified === "boolean")
        return body.verified;
    return status.toUpperCase() === "VERIFIED";
}
function readScore(body, audit, claims) {
    const candidates = [
        audit?.score,
        body.trustScore,
        body.trust_score,
        body.score,
        claims?.trustScore,
        claims?.trust_score,
        claims?.score,
    ];
    for (const candidate of candidates) {
        const score = readNumber(candidate);
        if (score !== undefined)
            return score;
    }
    return null;
}
function readFactors(audit) {
    const raw = audit?.factors ?? audit?.scoreFactors;
    if (!Array.isArray(raw))
        return [];
    return raw.map((item) => {
        const record = asRecord(item);
        return record ? { ...record } : { detail: String(item) };
    });
}
function readNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    return value;
}
//# sourceMappingURL=auditDomain.js.map