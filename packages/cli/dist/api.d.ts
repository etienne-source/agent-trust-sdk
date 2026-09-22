/** Production Trustflow Systems verification API. */
export declare const TRUSTFLOW_API_BASE = "https://api.trustflow.systems";
export type VerificationType = "SSL_CHALLENGE" | "DNS_TXT";
export interface RegisterRequest {
    domain: string;
    businessName: string;
    verificationType: VerificationType;
    did?: string;
    /** SPKI PEM. The live API stores this and sets `publicKeyHash` from it. */
    publicKeyPem?: string;
    publicKeyHash?: string;
    /** Public did.json URL. Stored on the challenge; not a secret. */
    manifestUrl?: string;
    services?: string[];
}
export interface RegisterChallenge {
    domain: string;
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
}
export interface ConfirmRequest {
    domain: string;
    challengeToken: string;
    did?: string;
    publicKeyHash?: string;
    services?: string[];
    businessName?: string;
}
export declare class TrustflowApiError extends Error {
    readonly status?: number;
    readonly body?: unknown;
    constructor(message: string, status?: number, body?: unknown);
}
/**
 * Resolve the API origin used for `/v1/register` and `/v1/register/confirm`.
 *
 * The live routes are on `https://api.trustflow.systems`. The site paths
 * `https://trustflow.systems/api` and `https://trustflow.systems/api/register`
 * (and the `www` host) are aliases of that origin — they are not separate APIs.
 * A full `.../v1/register` URL is reduced to its origin + prefix.
 */
export declare function resolveTrustflowApiBase(input?: string | null): string;
export declare function registerDomain(apiBase: string, body: RegisterRequest, fetchFn?: typeof fetch): Promise<RegisterChallenge>;
export declare function confirmRegistration(apiBase: string, body: ConfirmRequest, fetchFn?: typeof fetch): Promise<Record<string, unknown>>;
/** Default deadline for POST /v1/register and POST /v1/register/confirm. */
export declare const DEFAULT_API_TIMEOUT_MS = 20000;
//# sourceMappingURL=api.d.ts.map