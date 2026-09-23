import { compactVerify, decodeProtectedHeader, importJWK, importSPKI, } from "jose";
/**
 * JWS `alg` values accepted for Trustflow DID proofs.
 *
 * - `EdDSA` — Ed25519 (OKP, crv Ed25519). This is the JWS name for Ed25519.
 * - `ES256` — ECDSA P-256.
 *
 * `none`, symmetric `HS*` algorithms, and every other alg are rejected.
 */
export const ALLOWED_JWS_ALGS = ["EdDSA", "ES256"];
const ALLOWED_JWS_ALG_SET = new Set(ALLOWED_JWS_ALGS);
/**
 * Map key material to the single JWS alg this SDK will use with it.
 * RSA, Ed448, and non-P-256 curves fail closed.
 */
export function allowedAlgForKey(key) {
    if (key instanceof Uint8Array) {
        return key.byteLength === 32 ? "EdDSA" : null;
    }
    const cryptoKey = key;
    switch (cryptoKey.asymmetricKeyType) {
        case "ed25519":
            return "EdDSA";
        case "ec": {
            const curve = cryptoKey.asymmetricKeyDetails?.namedCurve;
            return curve === "prime256v1" || curve === "P-256" ? "ES256" : null;
        }
        default:
            break;
    }
    const name = cryptoKey.algorithm?.name;
    if (name === "Ed25519")
        return "EdDSA";
    if (name === "ECDSA" && cryptoKey.algorithm?.namedCurve === "P-256") {
        return "ES256";
    }
    return null;
}
function jwkSignatureAlg(jwk) {
    const declared = jwk.alg;
    if (declared != null && typeof declared !== "string")
        return null;
    if (typeof declared === "string") {
        const trimmed = declared.trim();
        if (trimmed.toLowerCase() === "none")
            return null;
        if (/^hs/i.test(trimmed))
            return null;
        if (!ALLOWED_JWS_ALG_SET.has(declared))
            return null;
    }
    let inferred = null;
    if (jwk.kty === "OKP" && jwk.crv === "Ed25519")
        inferred = "EdDSA";
    else if (jwk.kty === "EC" && jwk.crv === "P-256")
        inferred = "ES256";
    if (!inferred)
        return null;
    if (typeof declared === "string" && declared !== inferred)
        return null;
    return inferred;
}
const resolvedPublicKeys = new Map();
const pendingPublicKeys = new Map();
const signatureResults = new Map();
const keyIdentity = new WeakMap();
let keyIdentitySeq = 0;
/** Drop imported verification keys and cached signature results. `clearVerifyCache` calls this. */
export function clearPublicKeyCache() {
    resolvedPublicKeys.clear();
    pendingPublicKeys.clear();
    signatureResults.clear();
}
function identityOfKey(key) {
    if (key instanceof Uint8Array) {
        let hex = "";
        for (const byte of key)
            hex += byte.toString(16).padStart(2, "0");
        return `raw:${hex}`;
    }
    let id = keyIdentity.get(key);
    if (!id) {
        keyIdentitySeq += 1;
        id = `key:${keyIdentitySeq}`;
        keyIdentity.set(key, id);
    }
    return id;
}
function signatureCacheKey(did, key, jws) {
    return `${identityOfKey(key)}\n${did.id ?? ""}\n${jws}`;
}
async function loadPublicKey(did) {
    const vm = did.verificationMethod?.[0];
    if (!vm)
        return null;
    if (vm.publicKeyPem) {
        try {
            // jose's alg hint does not constrain the SPKI type; classify the key after import.
            const key = await importSPKI(vm.publicKeyPem, "EdDSA");
            if (!allowedAlgForKey(key))
                return null;
            return key;
        }
        catch {
            return null;
        }
    }
    if (vm.publicKeyJwk) {
        try {
            const jwk = vm.publicKeyJwk;
            const alg = jwkSignatureAlg(jwk);
            if (!alg)
                return null;
            const key = await importJWK(jwk, alg);
            if (allowedAlgForKey(key) !== alg)
                return null;
            return key;
        }
        catch {
            return null;
        }
    }
    return null;
}
function publicKeyCacheId(did) {
    const vm = did.verificationMethod?.[0];
    if (!vm)
        return undefined;
    if (typeof vm.publicKeyPem === "string" && vm.publicKeyPem.trim()) {
        return `pem:${vm.publicKeyPem}`;
    }
    if (vm.publicKeyJwk)
        return `jwk:${JSON.stringify(vm.publicKeyJwk)}`;
    return undefined;
}
/**
 * Import the first verification method.
 * Successful imports are cached in memory so a repeated domain does not
 * parse the same SPKI or JWK again. Private keys are not accepted here.
 */
export async function importPublicKey(did) {
    const cacheKey = publicKeyCacheId(did);
    if (!cacheKey)
        return loadPublicKey(did);
    const resolved = resolvedPublicKeys.get(cacheKey);
    if (resolved)
        return resolved;
    const pending = pendingPublicKeys.get(cacheKey);
    if (pending)
        return pending;
    const loading = loadPublicKey(did).then((key) => {
        pendingPublicKeys.delete(cacheKey);
        if (key)
            resolvedPublicKeys.set(cacheKey, key);
        return key;
    });
    pendingPublicKeys.set(cacheKey, loading);
    return loading;
}
function readProtectedAlg(jws) {
    let header;
    try {
        header = decodeProtectedHeader(jws);
    }
    catch {
        return { ok: false, reason: "Invalid or missing JWS protected header" };
    }
    const alg = header.alg;
    if (typeof alg !== "string" || alg.length === 0 || alg.trim() === "") {
        return { ok: false, reason: "Invalid or missing JWS alg header" };
    }
    if (alg.trim().toLowerCase() === "none") {
        return { ok: false, reason: `Disallowed JWS algorithm: ${alg}` };
    }
    if (/^hs/i.test(alg.trim())) {
        return { ok: false, reason: `Disallowed symmetric JWS algorithm: ${alg}` };
    }
    if (!ALLOWED_JWS_ALG_SET.has(alg)) {
        return { ok: false, reason: `Disallowed JWS algorithm: ${alg}` };
    }
    return { ok: true, alg: alg };
}
/**
 * Verify compact JWS attached as `did.proof.jws`.
 * Accepts only EdDSA (Ed25519) and ES256. `none`, `HS*`, and any other alg fail closed.
 */
export async function verifyDidJws(did, key) {
    const jws = did.proof?.jws;
    if (!jws) {
        return { ok: false, reason: "No JWS proof on DID document" };
    }
    const cached = signatureResults.get(signatureCacheKey(did, key, jws));
    if (cached)
        return cached.ok ? { ok: true } : { ok: false, reason: cached.reason };
    const headerAlg = readProtectedAlg(jws);
    if (!headerAlg.ok) {
        signatureResults.set(signatureCacheKey(did, key, jws), headerAlg);
        return headerAlg;
    }
    const keyAlg = allowedAlgForKey(key);
    if (!keyAlg || keyAlg !== headerAlg.alg) {
        const mismatch = { ok: false, reason: "JWS alg does not match verification key" };
        signatureResults.set(signatureCacheKey(did, key, jws), mismatch);
        return mismatch;
    }
    try {
        const { payload, protectedHeader } = await compactVerify(jws, key, {
            algorithms: [headerAlg.alg],
        });
        const verifiedAlg = protectedHeader.alg;
        if (verifiedAlg !== headerAlg.alg || !ALLOWED_JWS_ALG_SET.has(verifiedAlg)) {
            const rejected = {
                ok: false,
                reason: `Disallowed JWS algorithm: ${String(verifiedAlg)}`,
            };
            signatureResults.set(signatureCacheKey(did, key, jws), rejected);
            return rejected;
        }
        const decoded = new TextDecoder().decode(payload);
        try {
            const parsed = JSON.parse(decoded);
            if (parsed.id && parsed.id !== did.id) {
                const mismatch = { ok: false, reason: "JWS payload DID id mismatch" };
                signatureResults.set(signatureCacheKey(did, key, jws), mismatch);
                return mismatch;
            }
        }
        catch {
            // non-JSON payload still accepted if signature verifies
        }
        const ok = { ok: true };
        signatureResults.set(signatureCacheKey(did, key, jws), ok);
        return ok;
    }
    catch (err) {
        const failed = {
            ok: false,
            reason: err instanceof Error ? err.message : "JWS verification failed",
        };
        signatureResults.set(signatureCacheKey(did, key, jws), failed);
        return failed;
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