import { importPublicKey, verifyDidJws } from "./jws.js";
import { didWebId, wellKnownDidUrl } from "./tls.js";
function asDidRecord(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        return undefined;
    return body;
}
/**
 * GET `https://{domain}/.well-known/did.json`.
 * Network, HTTP, and JSON failures are returned. They are not thrown.
 */
export async function fetchDidDocument(domain, fetchFn, signal) {
    let response;
    try {
        response = await fetchFn(wellKnownDidUrl(domain), {
            method: "GET",
            headers: { Accept: "application/json" },
            redirect: "follow",
            signal,
        });
    }
    catch (error) {
        return { kind: "network", error };
    }
    if (!response.ok)
        return { kind: "http", status: response.status };
    try {
        return { kind: "document", body: await response.json() };
    }
    catch {
        return { kind: "invalid-json" };
    }
}
/**
 * Judge a parsed DID document without fetching.
 *
 * `incomplete` means there is no usable proof (missing key or JWS). Callers
 * may treat that as UNVERIFIED or fall through to the registry.
 * `risk` is authoritative: a non-`did:web` id or a JWS that does not verify.
 */
export async function assessDidDocument(domain, body) {
    const record = asDidRecord(body);
    if (!record) {
        return { outcome: "malformed", reason: "did.json is not a DID document" };
    }
    const did = record;
    const expected = didWebId(domain);
    const id = did.id;
    if (id && id !== expected && !String(id).startsWith("did:web:")) {
        return {
            outcome: "risk",
            reason: "DID id is not did:web",
            didId: typeof id === "string" ? id : undefined,
            did,
            record,
        };
    }
    const key = await importPublicKey(did);
    if (!key) {
        return {
            outcome: "incomplete",
            reason: "No usable public key in DID verificationMethod",
            did,
            record,
        };
    }
    if (typeof did.proof?.jws !== "string" || !did.proof.jws) {
        return {
            outcome: "incomplete",
            reason: "DID document has no JWS proof",
            did,
            record,
        };
    }
    const jwsResult = await verifyDidJws(did, key);
    if (!jwsResult.ok) {
        return {
            outcome: "risk",
            reason: jwsResult.reason ?? "Signature verification failed",
            didId: typeof did.id === "string" && did.id ? did.id : expected,
            did,
            record,
        };
    }
    return {
        outcome: "verified",
        did,
        didId: typeof did.id === "string" && did.id ? did.id : expected,
        record,
    };
}
//# sourceMappingURL=localDid.js.map