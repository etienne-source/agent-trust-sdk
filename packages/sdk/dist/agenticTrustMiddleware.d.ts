import { type MemoryCache } from "./cache.js";
import type { VerificationStatus } from "./types.js";
/** Registry used when no base URL is configured. */
export declare const DEFAULT_TRUST_API_URL = "https://api.trustflow.systems";
/** Verification calls abort after this long so a slow registry cannot stall an agent. */
export declare const DEFAULT_MIDDLEWARE_TIMEOUT_MS = 4000;
/**
 * Successful registry answers are cached briefly.
 * Longer-lived entries written by `verifyDomain` are still reused.
 */
export declare const DEFAULT_MIDDLEWARE_CACHE_TTL_MS: number;
export interface AgenticTrustMetadata {
    /** True only when the registry reports the domain as verified. */
    verified: boolean;
    /** Registry trust score when the domain is verified and a score was returned. */
    trustScore?: number;
    /** Set when the domain is unverified, risky, or the registry could not be reached. */
    securityWarning?: boolean;
    /** Why the payload should be treated as untrusted. */
    warning?: string;
    domain: string;
    status: VerificationStatus;
    did?: string;
}
export interface AgenticTrustMiddlewareOptions {
    /**
     * Registry base URL. Request path is always `/v1/verify`.
     * Defaults to `AGENTIC_TRUST_API_URL`, then `VERIFICATION_API_URL`,
     * then `https://api.trustflow.systems`.
     */
    verificationApiUrl?: string;
    /** Per-request timeout in milliseconds. Default 4000. */
    timeoutMs?: number;
    /** TTL for successful middleware lookups. Default 5 minutes. */
    cacheTtlMs?: number;
    /** Skip both the middleware cache and any `verifyDomain` cache entry. */
    bypassCache?: boolean;
    /** Underlying fetch used for registry and wrapped content requests. */
    fetch?: typeof globalThis.fetch;
    /** Response header that carries compact trust metadata. Default `x-agentic-trust`. */
    headerName?: string;
    /** Cache implementation. Defaults to the SDK memory cache. */
    cache?: MemoryCache;
}
export interface LangChainLikeDocument {
    pageContent?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface AgenticTrustMiddleware {
    /**
     * Validate a domain, URL, or `did:web` against the registry.
     * Network errors resolve to an unverified warning. They do not throw.
     */
    verify(target: string): Promise<AgenticTrustMetadata>;
    /**
     * Copy `context` and append trust metadata.
     * Unverified results also set `securityWarning: true` on the context.
     */
    annotateContext<T extends Record<string, unknown>>(context: T, target: string): Promise<T & {
        agenticTrust: AgenticTrustMetadata;
        securityWarning?: true;
    }>;
    /**
     * Annotate LangChain-style documents using `metadata.source` (or `metadata.url`).
     */
    annotateDocuments<D extends LangChainLikeDocument>(documents: D[], fallbackUrl?: string): Promise<D[]>;
    /**
     * Fetch wrapper for standard `fetch` and Vercel AI SDK provider `fetch` options.
     * Always sets the trust response header. JSON bodies gain `agenticTrust`.
     * Unverified JSON bodies also gain `securityWarning: true`.
     */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /**
     * Wrap a LangChain tool (`invoke` / `call`) or Vercel AI SDK tool (`execute`)
     * so URL-bearing calls append trust metadata to the tool result.
     */
    wrapTool<T extends object>(tool: T): T;
}
export declare function domainFromTarget(target: string): string;
/**
 * Demand-side verification middleware.
 *
 * When an agent fetches a domain, the wrapper checks local `did:web` (JWS)
 * or calls `GET {base}/v1/verify` and appends `{ verified, trustScore }`
 * metadata. Unverified domains and registry outages append `securityWarning: true`
 * and do not throw.
 *
 * @example
 * ```ts
 * const trust = agenticTrustMiddleware();
 * const context = await trust.annotateContext({ snippet }, "https://example.com");
 * const response = await trust.fetch("https://example.com/data.json");
 * ```
 */
export declare function agenticTrustMiddleware(options?: AgenticTrustMiddlewareOptions): AgenticTrustMiddleware;
//# sourceMappingURL=agenticTrustMiddleware.d.ts.map