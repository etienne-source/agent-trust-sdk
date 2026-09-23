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
    /** When set, the challenge file is written under this directory. */
    publicDir?: string;
    /**
     * Also write the challenge at the workspace root.
     * Next-like layouts pass false so the file exists only under `publicDir`.
     */
    mirrorRoot?: boolean;
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