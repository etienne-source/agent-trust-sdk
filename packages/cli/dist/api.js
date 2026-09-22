/** Production Trustflow Systems verification API. */
export const TRUSTFLOW_API_BASE = "https://api.trustflow.systems";
export class TrustflowApiError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.name = "TrustflowApiError";
        this.status = status;
        this.body = body;
    }
}
/**
 * Resolve the API origin used for `/v1/register` and `/v1/register/confirm`.
 *
 * The live routes are on `https://api.trustflow.systems`. The site paths
 * `https://trustflow.systems/api` and `https://trustflow.systems/api/register`
 * (and the `www` host) are aliases of that origin — they are not separate APIs.
 * A full `.../v1/register` URL is reduced to its origin + prefix.
 */
export function resolveTrustflowApiBase(input) {
    const raw = (input ?? "").trim();
    if (!raw)
        return TRUSTFLOW_API_BASE;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`Invalid Trustflow API URL: ${input}`);
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const siteAlias = (host === "trustflow.systems" || host === "www.trustflow.systems") &&
        (path === "/api" ||
            path === "/api/register" ||
            path === "/api/v1/register" ||
            path === "/api/v1/register/confirm");
    if (siteAlias)
        return TRUSTFLOW_API_BASE;
    if (path.endsWith("/v1/register/confirm")) {
        return joinOrigin(url, path.slice(0, -"/v1/register/confirm".length));
    }
    if (path.endsWith("/v1/register")) {
        return joinOrigin(url, path.slice(0, -"/v1/register".length));
    }
    return joinOrigin(url, path === "/" ? "" : path);
}
function joinOrigin(url, path) {
    const suffix = path.replace(/\/+$/, "");
    return `${url.origin}${suffix}`;
}
export async function registerDomain(apiBase, body, fetchFn = globalThis.fetch) {
    const payload = await postJson(`${apiBase}/v1/register`, body, fetchFn);
    const challenge = payload;
    if (!challenge.challengeToken || !challenge.instructions || !challenge.domain) {
        throw new TrustflowApiError("Register response is missing challengeToken, instructions, or domain", 200, payload);
    }
    return challenge;
}
export async function confirmRegistration(apiBase, body, fetchFn = globalThis.fetch) {
    const payload = await postJson(`${apiBase}/v1/register/confirm`, body, fetchFn);
    return payload;
}
async function postJson(url, body, fetchFn) {
    let response;
    try {
        response = await fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "request failed";
        throw new TrustflowApiError(`Trustflow API request failed: ${message}`);
    }
    const text = await response.text();
    let parsed = undefined;
    if (text) {
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = text;
        }
    }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
        const record = parsed;
        const message = [record.error, record.detail, record.hint]
            .filter((part) => typeof part === "string" && part.trim())
            .join(" — ");
        throw new TrustflowApiError(message || `Trustflow API HTTP ${response.status}`, response.status, parsed);
    }
    if (!response.ok) {
        const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        throw new TrustflowApiError(`Trustflow API HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status, parsed);
    }
    if (!parsed || typeof parsed !== "object") {
        throw new TrustflowApiError("Trustflow API returned a non-JSON body", response.status, parsed);
    }
    return parsed;
}
//# sourceMappingURL=api.js.map