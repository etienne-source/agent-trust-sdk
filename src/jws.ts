import { compactVerify, importSPKI, importJWK, type JWK, type KeyLike } from "jose";
import type { DidDocument } from "./types.js";

export type PublicKeyMaterial = KeyLike | Uint8Array;

export async function importPublicKey(
  did: DidDocument
): Promise<PublicKeyMaterial | null> {
  const vm = did.verificationMethod?.[0];
  if (!vm) return null;

  if (vm.publicKeyPem) {
    try {
      try {
        return await importSPKI(vm.publicKeyPem, "RS256");
      } catch {
        return await importSPKI(vm.publicKeyPem, "ES256");
      }
    } catch {
      return null;
    }
  }

  if (vm.publicKeyJwk) {
    try {
      const jwk = vm.publicKeyJwk as unknown as JWK;
      const alg = jwk.alg ?? (jwk.kty === "EC" ? "ES256" : "RS256");
      return await importJWK(jwk, alg);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Verify an AgenticTrust DID signature: compact JWS (RS256/ES256) attached as `did.proof.jws`.
 */
export async function verifyDidJws(
  did: DidDocument,
  key: PublicKeyMaterial
): Promise<{ ok: boolean; reason?: string }> {
  const jws = did.proof?.jws;
  if (!jws) {
    return { ok: false, reason: "No JWS proof on DID document" };
  }

  try {
    const { payload } = await compactVerify(jws, key);
    const decoded = new TextDecoder().decode(payload);
    try {
      const parsed = JSON.parse(decoded) as { id?: string };
      if (parsed.id && parsed.id !== did.id) {
        return { ok: false, reason: "JWS payload DID id mismatch" };
      }
    } catch {
      // non-JSON payload still accepted if signature verifies
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "JWS verification failed",
    };
  }
}

export function fingerprintPem(pem: string): string {
  let h = 0;
  for (let i = 0; i < pem.length; i++) {
    h = (Math.imul(31, h) + pem.charCodeAt(i)) | 0;
  }
  return `pem:${(h >>> 0).toString(16)}`;
}
