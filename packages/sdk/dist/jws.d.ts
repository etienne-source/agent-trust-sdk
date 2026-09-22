import { type KeyLike } from "jose";
import type { DidDocument } from "./types.js";
export type PublicKeyMaterial = KeyLike | Uint8Array;
/**
 * JWS `alg` values accepted for AgenticTrust DID proofs.
 *
 * - `EdDSA` — Ed25519 (OKP, crv Ed25519). This is the JWS name for Ed25519.
 * - `ES256` — ECDSA P-256.
 *
 * `none`, symmetric `HS*` algorithms, and every other alg are rejected.
 */
export declare const ALLOWED_JWS_ALGS: readonly ["EdDSA", "ES256"];
export type AllowedJwsAlg = (typeof ALLOWED_JWS_ALGS)[number];
/**
 * Map key material to the single JWS alg this SDK will use with it.
 * RSA, Ed448, and non-P-256 curves fail closed.
 */
export declare function allowedAlgForKey(key: PublicKeyMaterial): AllowedJwsAlg | null;
export declare function importPublicKey(did: DidDocument): Promise<PublicKeyMaterial | null>;
/**
 * Verify compact JWS attached as `did.proof.jws`.
 * Accepts only EdDSA (Ed25519) and ES256. `none`, `HS*`, and any other alg fail closed.
 */
export declare function verifyDidJws(did: DidDocument, key: PublicKeyMaterial): Promise<{
    ok: boolean;
    reason?: string;
}>;
export declare function fingerprintPem(pem: string): string;
//# sourceMappingURL=jws.d.ts.map