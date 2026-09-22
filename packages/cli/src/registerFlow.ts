import {
  registerDomain,
  type RegisterChallenge,
  type VerificationType,
} from "./api.js";
import { writeProjectFile, writePublishedFile, writeRegistration, type StoredRegistration } from "./project.js";

export interface RegisterAndStoreInput {
  cwd: string;
  apiBase: string;
  fetchFn: typeof fetch;
  domain: string;
  businessName: string;
  verificationType: VerificationType;
  did: string;
  publicKeyPem: string;
  publicKeyHash: string;
  services: string[];
  /** When set, the challenge file is written here and mirrored at the repository root. */
  publicDir?: string;
}

export interface RegisterAndStoreResult {
  challenge: RegisterChallenge;
  stored: StoredRegistration;
  registrationPath: string;
  challengeFile?: string;
}

/**
 * POST /v1/register, persist the challenge under `.agentic-trust/`, and write
 * the SSL challenge file when the registry asks for one.
 * Callers own logging. This function does not print the token or the key.
 */
export async function registerAndStore(input: RegisterAndStoreInput): Promise<RegisterAndStoreResult> {
  const challenge = await registerDomain(
    input.apiBase,
    {
      domain: input.domain,
      businessName: input.businessName,
      verificationType: input.verificationType,
      did: input.did,
      publicKeyPem: input.publicKeyPem,
      publicKeyHash: input.publicKeyHash,
      manifestUrl: `https://${input.domain}/.well-known/did.json`,
      services: input.services,
    },
    input.fetchFn
  );

  const stored: StoredRegistration = {
    domain: challenge.domain || input.domain,
    businessName: input.businessName,
    verificationType: challenge.verificationType || input.verificationType,
    challengeToken: challenge.challengeToken,
    challengePath: challenge.challengePath,
    dnsRecord: challenge.dnsRecord,
    instructions: challenge.instructions,
    expiresAt: challenge.expiresAt,
    tier: challenge.tier,
    did: input.did,
    publicKeyHash: input.publicKeyHash,
    services: input.services,
    apiBase: input.apiBase,
  };
  const registrationPath = await writeRegistration(input.cwd, stored);
  let challengeFile: string | undefined;
  if (challenge.verificationType === "SSL_CHALLENGE" || challenge.challengePath) {
    const leaf = ".well-known/agentic-trust-challenge.txt";
    if (input.publicDir) {
      const written = await writePublishedFile(input.cwd, input.publicDir, leaf, challenge.challengeToken);
      challengeFile = written[0];
    } else {
      challengeFile = await writeProjectFile(input.cwd, leaf, challenge.challengeToken);
    }
  }
  return { challenge, stored, registrationPath, challengeFile };
}
