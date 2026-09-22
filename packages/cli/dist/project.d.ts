import type { VerificationType } from "./api.js";
export declare const SECRETS_DIR = ".agentic-trust";
export interface StoredRegistration {
    domain: string;
    businessName: string;
    verificationType: VerificationType;
    challengeToken: string;
    challengePath?: string;
    dnsRecord?: {
        name: string;
        value: string;
    };
    instructions: string;
    expiresAt: string;
    tier?: string;
    did: string;
    publicKeyHash: string;
    services: string[];
    apiBase: string;
}
export declare function secretsDir(cwd: string): string;
export declare function ensureGitignore(cwd: string): Promise<"updated" | "present">;
export declare function writePrivateKey(cwd: string, pem: string): Promise<string>;
export declare function writePublicKey(cwd: string, pem: string): Promise<string>;
export declare function readKeyPair(cwd: string): Promise<{
    privateKeyPem: string;
    publicKeyPem: string;
} | undefined>;
export declare function writeRegistration(cwd: string, registration: StoredRegistration): Promise<string>;
export declare function readRegistration(cwd: string): Promise<StoredRegistration | undefined>;
export declare function writeProjectFile(cwd: string, relative: string, contents: string): Promise<string>;
//# sourceMappingURL=project.d.ts.map