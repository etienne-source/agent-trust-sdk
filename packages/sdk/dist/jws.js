import { compactVerify, importSPKI, importJWK } from "jose";
export async function importPublicKey(did) {
    const vm = did.verificationMethod?.[0];
    if (!vm)
        return null;
    if (vm.publicKeyPem) {
        try {
            try {
                return await importSPKI(vm.publicKeyPem, "RS256");
            }
            catch {
                return await importSPKI(vm.publicKeyPem, "ES256");
            }
        }
        catch {
            return null;
        }
    }
    if (vm.publicKeyJwk) {
        try {
            const jwk = vm.publicKeyJwk;
            const alg = jwk.alg ?? (jwk.kty === "EC" ? "ES256" : "RS256");
            return await importJWK(jwk, alg);
        }
        catch {
            return null;
        }
    }
    return null;
}
/**
 * Verify an AgenticTrust DID signature: compact JWS (RS256/ES256) attached as `did.proof.jws`.
 */
export async function verifyDidJws(did, key) {
    const jws = did.proof?.jws;
    if (!jws) {
        return { ok: false, reason: "No JWS proof on DID document" };
    }
    try {
        const { payload } = await compactVerify(jws, key);
        const decoded = new TextDecoder().decode(payload);
        try {
            const parsed = JSON.parse(decoded);
            if (parsed.id && parsed.id !== did.id) {
                return { ok: false, reason: "JWS payload DID id mismatch" };
            }
        }
        catch {
            // non-JSON payload still accepted if signature verifies
        }
        return { ok: true };
    }
    catch (err) {
        return {
            ok: false,
            reason: err instanceof Error ? err.message : "JWS verification failed",
        };
    }
}
export function fingerprintPem(pem) {
    let h = 0;
    for (let i = 0; i < pem.length; i++) {
        h = (Math.imul(31, h) + pem.charCodeAt(i)) | 0;
    }
    return `pem:${(h >>> 0).toString(16)}`;
}
//# sourceMappingURL=jws.js.map