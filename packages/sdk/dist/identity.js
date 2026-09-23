import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT, } from "jose";
import { didWebId, normalizeDomain, wellKnownLlmsUrl } from "./tls.js";
/**
 * SHA-256 (hex) of an SPKI PEM, matching the Trustflow registry `publicKeyHash`
 * (CRLF stripped, trimmed, then hashed).
 */
export function hashPublicKeyPem(pem) {
    const normalized = pem.replace(/\r\n/g, "\n").trim();
    return createHash("sha256").update(normalized).digest("hex");
}
/**
 * SHA-256 hex of an llms.txt body. A leading BOM and CRLF are normalized, and
 * one trailing newline is ignored, so the file on disk and the HTTP body match.
 */
export function hashLlmsTxt(text) {
    const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n$/, "");
    return createHash("sha256").update(normalized, "utf8").digest("hex");
}
function pemToString(value) {
    return typeof value === "string" ? value : value.toString("utf8");
}
/**
 * Derive the SPKI public key and a PKCS#8 copy from an Ed25519 or P-256 private key PEM.
 * Callers that only have `AGENTIC_TRUST_PRIVATE_KEY` use this path.
 */
export function publicKeyPemFromPrivate(privateKeyPem) {
    return signingMaterial(privateKeyPem).publicKeyPem;
}
function signingMaterial(privateKeyPem) {
    let keyObject;
    try {
        keyObject = createPrivateKey(privateKeyPem);
    }
    catch {
        throw new Error("Private key PEM could not be read. Expected an unencrypted Ed25519 or P-256 key (PKCS#8).");
    }
    let alg;
    if (keyObject.asymmetricKeyType === "ed25519") {
        alg = "EdDSA";
    }
    else if (keyObject.asymmetricKeyType === "ec") {
        const curve = keyObject.asymmetricKeyDetails?.namedCurve;
        if (curve !== "prime256v1" && curve !== "P-256") {
            throw new Error("EC private key must be P-256 (ES256).");
        }
        alg = "ES256";
    }
    else {
        throw new Error("Private key must be Ed25519 or P-256 (ES256).");
    }
    return {
        alg,
        pkcs8Pem: pemToString(keyObject.export({ type: "pkcs8", format: "pem" })),
        publicKeyPem: pemToString(createPublicKey(keyObject).export({ type: "spki", format: "pem" })),
    };
}
/**
 * Create a did:web document and compact JWS (Ed25519 or ES256) that `verifyDidJws` accepts.
 * Generated keys are Ed25519. The private key is returned to the caller; this function
 * does not write files and does not log key material.
 */
export async function createSignedDidDocument(input) {
    const domain = normalizeDomain(input.domain);
    const id = didWebId(domain);
    let privateKeyPem;
    let publicKeyPem;
    let alg;
    let signingKey;
    if (input.privateKeyPem) {
        const material = signingMaterial(input.privateKeyPem);
        privateKeyPem = material.pkcs8Pem;
        publicKeyPem = input.publicKeyPem ?? material.publicKeyPem;
        alg = material.alg;
        signingKey = await importPKCS8(material.pkcs8Pem, alg);
    }
    else {
        const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
        signingKey = pair.privateKey;
        publicKeyPem = await exportSPKI(pair.publicKey);
        privateKeyPem = await exportPKCS8(pair.privateKey);
        alg = "EdDSA";
    }
    const services = input.services && input.services.length > 0
        ? input.services
        : [
            {
                id: `${id}#llms`,
                type: "LinkedDomains",
                serviceEndpoint: wellKnownLlmsUrl(domain),
            },
        ];
    const llmsTxtSha256 = input.llmsTxtSha256?.trim().toLowerCase();
    if (llmsTxtSha256 && !/^[0-9a-f]{64}$/.test(llmsTxtSha256)) {
        throw new Error("llmsTxtSha256 must be a SHA-256 hex digest.");
    }
    const payload = {
        id,
        ...(llmsTxtSha256 ? { llmsTxtSha256 } : {}),
        verificationMethod: [
            {
                id: `${id}#key-1`,
                type: "JsonWebKey2020",
                controller: id,
                publicKeyPem,
            },
        ],
        assertionMethod: [`${id}#key-1`],
        service: services,
    };
    const jws = await new SignJWT(payload)
        .setProtectedHeader({ alg })
        .setIssuedAt()
        .sign(signingKey);
    const did = {
        "@context": ["https://www.w3.org/ns/did/v1"],
        ...payload,
        proof: {
            type: "JsonWebSignature2020",
            created: new Date().toISOString(),
            verificationMethod: `${id}#key-1`,
            jws,
        },
    };
    return {
        domain,
        did,
        publicKeyPem,
        privateKeyPem,
        publicKeyHash: hashPublicKeyPem(publicKeyPem),
    };
}
//# sourceMappingURL=identity.js.map