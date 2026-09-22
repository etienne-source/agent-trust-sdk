import { type VerificationType } from "./api.js";
/**
 * CLI wait budget for "register → proofs reachable → confirm".
 * Short on purpose: the loop should finish in well under 10 seconds once the
 * network can see the files. This does not include a hung API timeout.
 */
export declare const DEFAULT_PROOF_BUDGET_MS = 8000;
export declare const DEFAULT_PROOF_INTERVAL_MS = 200;
export type ProofProbe = "ready" | "pending" | "mismatch";
export interface LiveProofInput {
    fetchFn: typeof fetch;
    domain: string;
    didId: string;
    publicKeyPem: string;
    verificationType: VerificationType;
    challengeToken: string;
    challengeUrl?: string;
    dnsRecord?: {
        name: string;
        value: string;
    };
    resolveTxt?: (hostname: string) => Promise<string[][]>;
}
export interface AutoConfirmInput extends LiveProofInput {
    apiBase: string;
    publicKeyHash: string;
    businessName?: string;
    services?: string[];
    budgetMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    log: (line?: string) => void;
}
export interface AutoConfirmResult {
    code: number;
    verified: boolean;
    attempts: number;
}
/**
 * API assumption: `POST /v1/register` still returns `challengeToken` and, for
 * `SSL_CHALLENGE`, `challengePath` (`/.well-known/agentic-trust-challenge.txt`).
 * `POST /v1/register/confirm` still requires that token. This client does not
 * treat a live `did.json` as a substitute for the challenge file. It writes the
 * challenge, then confirms only after a short parallel poll sees both the live
 * DID (public key must match registration) and the challenge body, or the DNS
 * TXT record for `DNS_TXT`. Confirm is the registry check, not a local bypass.
 */
export declare function autoConfirm(input: AutoConfirmInput): Promise<AutoConfirmResult>;
export declare function confirmResultVerified(result: Record<string, unknown>): boolean;
export declare function isRetryableConfirmError(err: unknown): boolean;
export declare function probeLiveProofs(input: LiveProofInput): Promise<ProofProbe>;
//# sourceMappingURL=proofs.d.ts.map