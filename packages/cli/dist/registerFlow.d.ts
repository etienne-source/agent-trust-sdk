import { type RegisterChallenge, type VerificationType } from "./api.js";
import { type StoredRegistration } from "./project.js";
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
export declare function registerAndStore(input: RegisterAndStoreInput): Promise<RegisterAndStoreResult>;
//# sourceMappingURL=registerFlow.d.ts.map