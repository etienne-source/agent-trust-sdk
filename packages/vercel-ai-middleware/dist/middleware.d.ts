import { type AgenticTrustMetadata, type AgenticTrustMiddlewareOptions } from "@agentic-trust/sdk";
import { type ParsedLlmsTxt } from "./llms.js";
/** Request header that marks a fetch as domain context even when the path is not `llms.txt`. */
export declare const AGENTIC_TRUST_CONTEXT_HEADER = "x-agentic-trust-context";
export interface AgenticTrustVercelAiOptions extends AgenticTrustMiddlewareOptions {
    /**
     * Domain check. When omitted, the package calls `agenticTrustMiddleware`
     * from `@agentic-trust/sdk` (the verify/sign implementation).
     */
    verify?: (target: string) => Promise<AgenticTrustMetadata>;
    /**
     * Fail closed by default. Unverified or tampered `llms.txt` throws
     * `UnverifiedDomainContextError` before the response stream or the model runs.
     * Set `false` to continue without parsing that payload.
     */
    failClosed?: boolean;
    /**
     * Fetch used to load context after verification succeeds.
     * Registry calls use `fetch` on the SDK options, not this function.
     */
    contextFetch?: typeof globalThis.fetch;
}
export interface LlmsContextSource {
    target: string;
    content: string | (() => string);
}
export interface VerifiedLlmsContext extends ParsedLlmsTxt {
    target: string;
    domain: string;
    text: string;
    sourceText: string;
    agenticTrust: AgenticTrustMetadata;
}
export interface LanguageModelCallArgs<TGenerate, TStream> {
    doGenerate: () => Promise<TGenerate> | TGenerate;
    doStream: () => Promise<TStream> | TStream;
    params: unknown;
    model?: unknown;
}
type VerifyFn = (target: string) => Promise<AgenticTrustMetadata>;
export interface AgenticTrustVercelAiMiddleware {
    /** Fetch interceptor. Context URLs are verified before the response body is read. */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /** Rewrites prompt payloads after verification. The Vercel AI SDK runs this before `doStream` / `doGenerate`. */
    transformParams<T>(args: {
        params: T;
        type?: "generate" | "stream";
        model?: unknown;
    }): Promise<T>;
    wrapGenerate<T>(args: LanguageModelCallArgs<T, unknown>): Promise<T>;
    wrapStream<T>(args: LanguageModelCallArgs<unknown, T>): Promise<T>;
    loadLlmsFromUrl(url: string): Promise<VerifiedLlmsContext>;
}
export declare function createVerifier(options?: AgenticTrustVercelAiOptions): VerifyFn;
export declare function isFailClosed(options?: {
    failClosed?: boolean;
}): boolean;
export declare function requireVerifiedDomain(target: string, verify: VerifyFn): Promise<AgenticTrustMetadata>;
/**
 * Vercel AI SDK fetch and language-model middleware.
 *
 * Pass `fetch` to a provider factory and the object itself to `wrapLanguageModel`.
 * Unverified or tampered domain context throws `UnverifiedDomainContextError`
 * before the response stream starts and before `llms.txt` is parsed.
 * That block is the default (`failClosed: true`).
 */
export declare function agenticTrustVercelAiMiddleware(options?: AgenticTrustVercelAiOptions): AgenticTrustVercelAiMiddleware;
/** Verify with the SDK, fetch the URL, then parse `llms.txt`. */
export declare function loadVerifiedLlmsFromUrl(url: string, options?: AgenticTrustVercelAiOptions): Promise<VerifiedLlmsContext>;
/** Verify a domain and throw `UnverifiedDomainContextError` when it is not signed. */
export declare function assertVerifiedDomain(target: string, options?: AgenticTrustVercelAiOptions): Promise<AgenticTrustMetadata>;
export declare function readVerifiedLlms(source: LlmsContextSource, options?: AgenticTrustVercelAiOptions): Promise<VerifiedLlmsContext>;
export {};
//# sourceMappingURL=middleware.d.ts.map