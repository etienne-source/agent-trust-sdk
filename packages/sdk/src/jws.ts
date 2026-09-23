import {
  compactVerify,
  decodeProtectedHeader,
  importJWK,
  importSPKI,
  type JWK,
  type KeyLike,
} from "jose";
import { type KeyObject } from "node:crypto";
import type { DidDocument } from "./types.js";

export type PublicKeyMaterial = KeyLike | Uint8Array;

/**
 * JWS `alg` values accepted for Trustflow DID proofs.
 *
 * - `EdDSA` — Ed25519 (OKP, crv Ed25519). This is the JWS name for Ed25519.
 * - `ES256` — ECDSA P-256.
 *
 * `none`, symmetric `HS*` algorithms, and every other alg are rejected.
 */
export const ALLOWED_JWS_ALGS = ["EdDSA", "ES256"] as const;

export type AllowedJwsAlg = (typeof ALLOWED_JWS_ALGS)[number];

const ALLOWED_JWS_ALG_SET: ReadonlySet<string> = new Set(ALLOWED_JWS_ALGS);

type KeyWithAlgorithm = KeyObject & {
  algorithm?: { name?: string; namedCurve?: string };
};

/**
 * Map key material to the single JWS alg this SDK will use with it.
 * RSA, Ed448, and non-P-256 curves fail closed.
 */
export function allowedAlgForKey(key: PublicKeyMaterial): AllowedJwsAlg | null {
  if (key instanceof Uint8Array) {
    return key.byteLength === 32 ? "EdDSA" : null;
  }

  const cryptoKey = key as KeyWithAlgorithm;
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
  if (name === "Ed25519") return "EdDSA";
  if (name === "ECDSA" && cryptoKey.algorithm?.namedCurve === "P-256") {
    return "ES256";
  }
  return null;
}

function jwkSignatureAlg(jwk: JWK): AllowedJwsAlg | null {
  const declared = jwk.alg;
  if (declared != null && typeof declared !== "string") return null;
  if (typeof declared === "string") {
    const trimmed = declared.trim();
    if (trimmed.toLowerCase() === "none") return null;
    if (/^hs/i.test(trimmed)) return null;
    if (!ALLOWED_JWS_ALG_SET.has(declared)) return null;
  }

  let inferred: AllowedJwsAlg | null = null;
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") inferred = "EdDSA";
  else if (jwk.kty === "EC" && jwk.crv === "P-256") inferred = "ES256";
  if (!inferred) return null;
  if (typeof declared === "string" && declared !== inferred) return null;
  return inferred;
}

async function loadPublicKey(did: DidDocument): Promise<PublicKeyMaterial | null> {
  const vm = did.verificationMethod?.[0];
  if (!vm) return null;

  if (vm.publicKeyPem) {
    for (const alg of ALLOWED_JWS_ALGS) {
      try {
        const key = await importSPKI(vm.publicKeyPem, alg);
        if (allowedAlgForKey(key) === alg) return key;
      } catch {
        continue;
      }
    }
    return null;
  }

  if (vm.publicKeyJwk) {
    try {
      const jwk = vm.publicKeyJwk as unknown as JWK;
      const alg = jwkSignatureAlg(jwk);
      if (!alg) return null;
      const key = await importJWK(jwk, alg);
      if (allowedAlgForKey(key) !== alg) return null;
      return key;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Import the first verification method. Private keys are not accepted here.
 */
export async function importPublicKey(
  did: DidDocument
): Promise<PublicKeyMaterial | null> {
  return loadPublicKey(did);
}

function readProtectedAlg(
  jws: string
): { ok: true; alg: AllowedJwsAlg } | { ok: false; reason: string } {
  let header: { alg?: unknown };
  try {
    header = decodeProtectedHeader(jws) as { alg?: unknown };
  } catch {
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
  return { ok: true, alg: alg as AllowedJwsAlg };
}

/**
 * Verify compact JWS attached as `did.proof.jws`.
 * Accepts only EdDSA (Ed25519) and ES256. `none`, `HS*`, and any other alg fail closed.
 */
export async function verifyDidJws(
  did: DidDocument,
  key: PublicKeyMaterial
): Promise<{ ok: boolean; reason?: string; llmsTxtSha256?: string }> {
  const jws = did.proof?.jws;
  if (!jws) {
    return { ok: false, reason: "No JWS proof on DID document" };
  }

  const headerAlg = readProtectedAlg(jws);
  if (!headerAlg.ok) {
    return headerAlg;
  }

  const keyAlg = allowedAlgForKey(key);
  if (!keyAlg || keyAlg !== headerAlg.alg) {
    const mismatch = { ok: false as const, reason: "JWS alg does not match verification key" };
    return mismatch;
  }

  try {
    const { payload, protectedHeader } = await compactVerify(jws, key, {
      algorithms: [headerAlg.alg],
    });
    const verifiedAlg = protectedHeader.alg;
    if (verifiedAlg !== headerAlg.alg || !ALLOWED_JWS_ALG_SET.has(verifiedAlg)) {
      const rejected = {
        ok: false as const,
        reason: `Disallowed JWS algorithm: ${String(verifiedAlg)}`,
      };
      return rejected;
    }
    const decoded = new TextDecoder().decode(payload);
    let parsed: {
      id?: string;
      llmsTxtSha256?: string;
      verificationMethod?: Array<{ publicKeyPem?: string; publicKeyJwk?: unknown }>;
    };
    try {
      parsed = JSON.parse(decoded) as typeof parsed;
    } catch {
      const rejected = { ok: false as const, reason: "JWS payload is not JSON" };
      return rejected;
    }
    if (!parsed.id || parsed.id !== did.id) {
      const mismatch = { ok: false as const, reason: "JWS payload DID id mismatch" };
      return mismatch;
    }
    const signedVm = parsed.verificationMethod?.[0];
    if (signedVm) {
      const fileVm = did.verificationMethod?.[0];
      const signedPem = normalizePem(signedVm.publicKeyPem);
      const filePem = normalizePem(fileVm?.publicKeyPem);
      const keyBound =
        Boolean(signedPem && filePem && signedPem === filePem) ||
        Boolean(
          signedVm.publicKeyJwk &&
            fileVm?.publicKeyJwk &&
            JSON.stringify(signedVm.publicKeyJwk) === JSON.stringify(fileVm.publicKeyJwk)
        );
      if (!keyBound) {
        const unbound = { ok: false as const, reason: "JWS payload key does not match document" };
        return unbound;
      }
    }
    const llmsTxtSha256 = readLlmsHash(parsed.llmsTxtSha256, did.llmsTxtSha256);
    if (!llmsTxtSha256.ok) {
      return llmsTxtSha256;
    }
    const ok = { ok: true as const, llmsTxtSha256: llmsTxtSha256.hash };
    return ok;
  } catch (err) {
    const failed = {
      ok: false as const,
      reason: err instanceof Error ? err.message : "JWS verification failed",
    };
    return failed;
  }
}

function normalizePem(pem: string | undefined): string {
  return (pem ?? "").replace(/\r\n/g, "\n").trim();
}

function readLlmsHash(
  signed: string | undefined,
  published: string | undefined
): { ok: true; hash?: string } | { ok: false; reason: string } {
  const claim = typeof signed === "string" ? signed.trim().toLowerCase() : "";
  const file = typeof published === "string" ? published.trim().toLowerCase() : "";
  if (claim && !/^[0-9a-f]{64}$/.test(claim)) {
    return { ok: false, reason: "JWS llms.txt hash is not SHA-256" };
  }
  if (file && !/^[0-9a-f]{64}$/.test(file)) {
    return { ok: false, reason: "DID llms.txt hash is not SHA-256" };
  }
  if (claim && file && claim !== file) {
    return { ok: false, reason: "JWS llms.txt hash does not match document" };
  }
  if (!claim && file) {
    return { ok: false, reason: "DID llms.txt hash is not signed" };
  }
  return { ok: true, hash: claim || undefined };
}

