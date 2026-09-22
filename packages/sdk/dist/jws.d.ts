import { type KeyLike } from "jose";
import type { DidDocument } from "./types.js";
export type PublicKeyMaterial = KeyLike | Uint8Array;
export declare function importPublicKey(did: DidDocument): Promise<PublicKeyMaterial | null>;
/**
 * Verify an AgenticTrust DID signature: compact JWS (RS256/ES256) attached as `did.proof.jws`.
 */
export declare function verifyDidJws(did: DidDocument, key: PublicKeyMaterial): Promise<{
    ok: boolean;
    reason?: string;
}>;
export declare function fingerprintPem(pem: string): string;
//# sourceMappingURL=jws.d.ts.map