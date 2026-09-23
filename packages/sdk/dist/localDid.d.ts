import type { DidDocument } from "./types.js";
export type DidFetchResult = {
    kind: "document";
    body: unknown;
} | {
    kind: "http";
    status: number;
} | {
    kind: "network";
    error: unknown;
} | {
    kind: "invalid-json";
};
export type DidAssessment = {
    outcome: "verified";
    did: DidDocument;
    didId: string;
    record: Record<string, unknown>;
    llmsTxtSha256?: string;
} | {
    outcome: "risk";
    reason: string;
    didId?: string;
    did: DidDocument;
    record: Record<string, unknown>;
} | {
    outcome: "incomplete";
    reason: string;
    did: DidDocument;
    record: Record<string, unknown>;
} | {
    outcome: "malformed";
    reason: string;
};
/**
 * GET `https://{domain}/.well-known/did.json`.
 * Network, HTTP, and JSON failures are returned. They are not thrown.
 */
export declare function fetchDidDocument(domain: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<DidFetchResult>;
/**
 * Judge a parsed DID document without fetching.
 *
 * `incomplete` means there is no usable proof (missing key or JWS). Callers
 * may treat that as UNVERIFIED or fall through to the registry.
 * `risk` is authoritative: a non-`did:web` id or a JWS that does not verify.
 */
export declare function assessDidDocument(domain: string, body: unknown): Promise<DidAssessment>;
//# sourceMappingURL=localDid.d.ts.map