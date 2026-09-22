import { createHash } from "node:crypto";
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
 * Create a did:web document and compact JWS (RS256) that `verifyDidJws` accepts.
 * The private key is returned to the caller; this function does not write files.
 */
export async function createSignedDidDocument(input) {
    const domain = normalizeDomain(input.domain);
    const id = didWebId(domain);
    let privateKeyPem = input.privateKeyPem;
    let publicKeyPem = input.publicKeyPem;
    const privateKey = privateKeyPem
        ? await importPKCS8(privateKeyPem, "RS256")
        : null;
    let signingKey = privateKey;
    if (!signingKey) {
        const pair = await generateKeyPair("RS256", { extractable: true });
        signingKey = pair.privateKey;
        publicKeyPem = await exportSPKI(pair.publicKey);
        privateKeyPem = await exportPKCS8(pair.privateKey);
    }
    else if (!publicKeyPem) {
        throw new Error("publicKeyPem is required when reusing a private key");
    }
    if (!publicKeyPem || !privateKeyPem) {
        throw new Error("Failed to generate did:web keypair");
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
    const payload = {
        id,
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
        .setProtectedHeader({ alg: "RS256" })
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