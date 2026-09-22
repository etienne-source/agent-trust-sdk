import { registerDomain, } from "./api.js";
import { writeProjectFile, writeRegistration } from "./project.js";
/**
 * POST /v1/register, persist the challenge under `.agentic-trust/`, and write
 * the SSL challenge file when the registry asks for one.
 * Callers own logging. This function does not print the token or the key.
 */
export async function registerAndStore(input) {
    const challenge = await registerDomain(input.apiBase, {
        domain: input.domain,
        businessName: input.businessName,
        verificationType: input.verificationType,
        did: input.did,
        publicKeyPem: input.publicKeyPem,
        publicKeyHash: input.publicKeyHash,
        manifestUrl: `https://${input.domain}/.well-known/did.json`,
        services: input.services,
    }, input.fetchFn);
    const stored = {
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
    let challengeFile;
    if (challenge.verificationType === "SSL_CHALLENGE" || challenge.challengePath) {
        challengeFile = await writeProjectFile(input.cwd, ".well-known/agentic-trust-challenge.txt", challenge.challengeToken);
    }
    return { challenge, stored, registrationPath, challengeFile };
}
//# sourceMappingURL=registerFlow.js.map