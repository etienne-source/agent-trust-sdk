import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  SignJWT,
  type JWTPayload,
} from "jose";
import { didWebId, normalizeDomain, wellKnownLlmsUrl } from "./tls.js";
import type { DidDocument } from "./types.js";

export interface DidServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface CreateSignedDidInput {
  /** Hostname or URL. Normalized to a lowercase hostname. */
  domain: string;
  services?: DidServiceEndpoint[];
  /**
   * RSA private key PEM (PKCS#8 or PKCS#1). When set, the matching SPKI public
   * key is derived unless `publicKeyPem` is also provided.
   */
  privateKeyPem?: string;
  publicKeyPem?: string;
}

export interface SignedDidIdentity {
  domain: string;
  did: DidDocument;
  publicKeyPem: string;
  privateKeyPem: string;
  /** SHA-256 hex of the normalized SPKI PEM. This is the registry `publicKeyHash`. */
  publicKeyHash: string;
}

/**
 * SHA-256 (hex) of an SPKI PEM, matching the Trustflow registry `publicKeyHash`
 * (CRLF stripped, trimmed, then hashed).
 */
export function hashPublicKeyPem(pem: string): string {
  const normalized = pem.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function pemToString(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

/**
 * Derive the SPKI public key and a PKCS#8 copy from an RSA private key PEM.
 * Callers that only have `AGENTIC_TRUST_PRIVATE_KEY` use this path.
 */
export function publicKeyPemFromPrivate(privateKeyPem: string): string {
  return rsaMaterial(privateKeyPem).publicKeyPem;
}

function rsaMaterial(privateKeyPem: string): { pkcs8Pem: string; publicKeyPem: string } {
  let keyObject: KeyObject;
  try {
    keyObject = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error("Private key PEM could not be read. Expected an unencrypted RSA key (PKCS#8 or PKCS#1).");
  }
  if (keyObject.asymmetricKeyType !== "rsa") {
    throw new Error("Private key must be RSA (RS256 did:web).");
  }
  return {
    pkcs8Pem: pemToString(keyObject.export({ type: "pkcs8", format: "pem" })),
    publicKeyPem: pemToString(createPublicKey(keyObject).export({ type: "spki", format: "pem" })),
  };
}

/**
 * Create a did:web document and compact JWS (RS256) that `verifyDidJws` accepts.
 * The private key is returned to the caller; this function does not write files
 * and does not log key material.
 */
export async function createSignedDidDocument(
  input: CreateSignedDidInput
): Promise<SignedDidIdentity> {
  const domain = normalizeDomain(input.domain);
  const id = didWebId(domain);

  let privateKeyPem: string;
  let publicKeyPem: string;
  let signingKey: Awaited<ReturnType<typeof importPKCS8>> | Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

  if (input.privateKeyPem) {
    privateKeyPem = input.privateKeyPem;
    if (input.publicKeyPem) {
      publicKeyPem = input.publicKeyPem;
      signingKey = await importPKCS8(input.privateKeyPem, "RS256");
    } else {
      const material = rsaMaterial(input.privateKeyPem);
      publicKeyPem = material.publicKeyPem;
      signingKey = await importPKCS8(material.pkcs8Pem, "RS256");
    }
  } else {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signingKey = pair.privateKey;
    publicKeyPem = await exportSPKI(pair.publicKey);
    privateKeyPem = await exportPKCS8(pair.privateKey);
  }

  const services =
    input.services && input.services.length > 0
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

  const jws = await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .sign(signingKey);

  const did: DidDocument = {
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
