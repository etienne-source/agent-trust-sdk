import { signRegisterConfirmProof } from "@trustflow/sdk";
import type { ConfirmRequest } from "./api.js";
import { readPrivateKey } from "./project.js";

export const MISSING_CONFIRM_KEY =
  "A did:web private key is required to POST /v1/register/confirm. Run trustflow init or set AGENTIC_TRUST_PRIVATE_KEY. The private key is not printed.";

/**
 * Build the register-confirm body the API accepts: domain, challengeToken, and
 * a compact JWS `proof` signed by the domain private key. The PEM is not sent.
 */
export async function buildConfirmRequest(input: {
  domain: string;
  challengeToken: string;
  privateKeyPem: string;
  did?: string;
  publicKeyHash?: string;
  services?: string[];
  businessName?: string;
}): Promise<ConfirmRequest> {
  const proof = await signRegisterConfirmProof({
    domain: input.domain,
    challengeToken: input.challengeToken,
    privateKeyPem: input.privateKeyPem,
  });
  return {
    domain: input.domain,
    challengeToken: input.challengeToken,
    proof,
    did: input.did,
    publicKeyHash: input.publicKeyHash,
    services: input.services,
    businessName: input.businessName,
  };
}

export async function resolveConfirmPrivateKey(input: {
  cwd: string;
  privateKeyPem?: string;
}): Promise<string> {
  const inline = input.privateKeyPem?.trim();
  if (inline) return inline;
  const fromDisk = await readPrivateKey(input.cwd);
  if (fromDisk) return fromDisk;
  throw new Error(MISSING_CONFIRM_KEY);
}
