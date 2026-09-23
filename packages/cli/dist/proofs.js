import { resolveTxt as defaultResolveTxt } from "node:dns/promises";
import { sameSiteRedirect } from "@trustflow/sdk";
import { confirmRegistration, TrustflowApiError } from "./api.js";
/**
 * CLI wait budget for "register → proofs reachable → confirm".
 * Short on purpose for the gap between probes. The overall window is
 * {@link DEFAULT_PROOF_BUDGET_MS}. This does not include a hung API timeout.
 */
export const DEFAULT_PROOF_BUDGET_MS = 90_000;
export const DEFAULT_PROOF_INTERVAL_MS = 200;
const PROOF_FETCH_TIMEOUT_MS = 1_500;
/**
 * API assumption: `POST /v1/register` still returns `challengeToken` and, for
 * `SSL_CHALLENGE`, `challengePath` (`/.well-known/agentic-trust-challenge.txt`).
 * `POST /v1/register/confirm` still requires that token. This client does not
 * treat a live `did.json` as a substitute for the challenge file. It writes the
 * challenge, then confirms only after a poll sees both the live
 * DID (public key must match registration) and the challenge body, or the DNS
 * TXT record for `DNS_TXT`. The default window is 90 seconds so a deploy can
 * finish. The interval stays short, so a site that is already live confirms
 * on the first check. Confirm is the registry check, not a local bypass.
 */
export async function autoConfirm(input) {
    const budgetMs = input.budgetMs ?? DEFAULT_PROOF_BUDGET_MS;
    const intervalMs = input.intervalMs ?? DEFAULT_PROOF_INTERVAL_MS;
    const sleep = input.sleep ?? delay;
    const now = input.now ?? Date.now;
    const started = now();
    let attempts = 0;
    let confirmAttempted = false;
    let loggedRetry = false;
    input.log("Checking live ownership proofs.");
    const logRetry = (line) => {
        if (loggedRetry)
            return;
        loggedRetry = true;
        input.log(line);
    };
    while (true) {
        attempts += 1;
        const proof = await probeLiveProofs(input);
        if (proof === "mismatch") {
            input.log("Live did.json is publicly reachable, but its public key does not match this registration.");
            input.log("Confirm was not sent.");
            return { code: 1, verified: false, attempts };
        }
        if (proof === "ready") {
            confirmAttempted = true;
            try {
                const result = await confirmRegistration(input.apiBase, {
                    domain: input.domain,
                    challengeToken: input.challengeToken,
                    did: input.didId,
                    publicKeyHash: input.publicKeyHash,
                    services: input.services,
                    businessName: input.businessName,
                }, input.fetchFn);
                if (confirmResultVerified(result)) {
                    input.log("Registration confirmed.");
                    input.log(JSON.stringify(result, null, 2));
                    return { code: 0, verified: true, attempts };
                }
                logRetry("Confirm returned before the domain was verified. Retrying.");
            }
            catch (err) {
                if (!isRetryableConfirmError(err))
                    throw err;
                logRetry("Registry has not accepted the live proof yet. Retrying.");
            }
        }
        const elapsed = now() - started;
        if (elapsed >= budgetMs) {
            input.log(proofTimeoutMessage(input));
            input.log(confirmAttempted
                ? "Confirm did not verify before the proof window closed."
                : "Confirm was not sent. No live proof was observed.");
            return { code: 1, verified: false, attempts };
        }
        await sleep(Math.min(intervalMs, budgetMs - elapsed));
    }
}
export function confirmResultVerified(result) {
    if (result.ok === true || result.isVerified === true || result.verified === true)
        return true;
    const status = typeof result.status === "string" ? result.status.toUpperCase() : "";
    return status === "VERIFIED";
}
export function isRetryableConfirmError(err) {
    if (!(err instanceof TrustflowApiError))
        return false;
    if (err.status == null)
        return false;
    if (err.status === 404 || err.status === 408 || err.status === 425 || err.status === 429 || err.status === 503) {
        return true;
    }
    const message = err.message.toLowerCase();
    return (message.includes("domain proof") ||
        message.includes("proof failed") ||
        message.includes("challenge file") ||
        message.includes("challenge mismatch") ||
        message.includes("not yet"));
}
export async function probeLiveProofs(input) {
    const checks = [probeDid(input)];
    if (input.verificationType === "DNS_TXT")
        checks.push(probeDns(input));
    else
        checks.push(probeChallenge(input));
    const results = await Promise.all(checks);
    if (results.includes("mismatch"))
        return "mismatch";
    if (results.every((result) => result === "ready"))
        return "ready";
    return "pending";
}
async function probeDid(input) {
    const url = `https://${input.domain}/.well-known/did.json`;
    const body = await fetchText(input.fetchFn, url);
    if (body === undefined)
        return "pending";
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return "pending";
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return "pending";
    const doc = parsed;
    if (typeof doc.id === "string" && doc.id !== input.didId)
        return "mismatch";
    const pems = publicKeyPems(doc.verificationMethod);
    if (pems.length === 0)
        return "pending";
    const expected = normalizePem(input.publicKeyPem);
    if (!pems.some((pem) => normalizePem(pem) === expected))
        return "mismatch";
    return "ready";
}
async function probeChallenge(input) {
    const url = input.challengeUrl || `https://${input.domain}/.well-known/agentic-trust-challenge.txt`;
    const body = await fetchText(input.fetchFn, url);
    if (body === undefined)
        return "pending";
    if (body === input.challengeToken || body.replace(/\r?\n$/, "") === input.challengeToken)
        return "ready";
    return "pending";
}
async function probeDns(input) {
    const name = input.dnsRecord?.name || `_agentic-trust.${input.domain}`;
    const resolve = input.resolveTxt ?? defaultResolveTxt;
    try {
        const records = await resolve(name);
        return txtMatches(records, input.challengeToken, input.dnsRecord?.value) ? "ready" : "pending";
    }
    catch {
        return "pending";
    }
}
function txtMatches(records, token, expectedValue) {
    const flat = records.map((parts) => parts.join(""));
    if (expectedValue && flat.some((value) => value === expectedValue || value.trim() === expectedValue))
        return true;
    return token.length > 0 && flat.some((value) => value.includes(token));
}
function publicKeyPems(verificationMethod) {
    if (!Array.isArray(verificationMethod))
        return [];
    const pems = [];
    for (const entry of verificationMethod) {
        if (!entry || typeof entry !== "object")
            continue;
        const pem = entry.publicKeyPem;
        if (typeof pem === "string" && pem.trim())
            pems.push(pem);
    }
    return pems;
}
function normalizePem(pem) {
    return pem.replace(/\r\n/g, "\n").trim();
}
async function fetchText(fetchFn, url) {
    try {
        const response = await fetchFn(url, {
            method: "GET",
            redirect: "manual",
            headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
            signal: proofSignal(),
        });
        const final = response.status >= 300 && response.status < 400
            ? await (async () => {
                const next = sameSiteRedirect(url, response.headers.get("location"));
                if (!next)
                    return response;
                return fetchFn(next, {
                    method: "GET",
                    redirect: "manual",
                    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
                    signal: proofSignal(),
                });
            })()
            : response;
        if (!final.ok)
            return undefined;
        return await final.text();
    }
    catch {
        return undefined;
    }
}
function proofSignal() {
    try {
        return AbortSignal.timeout(PROOF_FETCH_TIMEOUT_MS);
    }
    catch {
        return undefined;
    }
}
function proofTimeoutMessage(input) {
    if (input.verificationType === "DNS_TXT") {
        const name = input.dnsRecord?.name || `_agentic-trust.${input.domain}`;
        return `DNS TXT ${name} was not visible within the proof window. Publish it, then run trustflow confirm.`;
    }
    const didUrl = `https://${input.domain}/.well-known/did.json`;
    const challenge = input.challengeUrl || `https://${input.domain}/.well-known/agentic-trust-challenge.txt`;
    return `HTTPS proofs were not reachable within the proof window (${didUrl}, ${challenge}). Deploy the public directory, then run trustflow confirm.`;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=proofs.js.map