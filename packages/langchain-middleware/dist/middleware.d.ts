import { type AgenticTrustEnforcementMode, type AgenticTrustMetadata, type AgenticTrustMiddlewareOptions, type AgenticTrustSecurityEvent } from "@agentic-trust/sdk";
import { type ParsedLlmsTxt } from "./llms.js";
export interface AgenticTrustLangChainOptions extends AgenticTrustMiddlewareOptions {
    /**
     * Domain check. When omitted, the package calls `agenticTrustMiddleware`
     * from `@agentic-trust/sdk` (the verify/sign implementation).
     */
    verify?: (target: string) => Promise<AgenticTrustMetadata>;
    /**
     * Enforcement. The default is `"audit"`: unsigned context does not throw.
     * `"strict"` throws `UnverifiedDomainContextError` before the body is read.
     */
    mode?: AgenticTrustEnforcementMode;
    /** `true` selects strict mode. */
    strict?: boolean;
    /**
     * `true` selects strict mode. Omitted and `false` stay in audit mode.
     * Fail-closed is no longer the default.
     */
    failClosed?: boolean;
    /** Receives the audit telemetry event. The default sink is an in-process listener plus `console.warn`. */
    onAudit?: (event: AgenticTrustSecurityEvent) => void;
}
export interface LlmsContextSource {
    /** Domain, https URL, or `did:web` id. Read before the body. */
    target: string;
    /**
     * Raw `llms.txt`. A function is not called unless the domain verifies.
     */
    content: string | (() => string);
}
export interface VerifiedLlmsContext extends ParsedLlmsTxt {
    target: string;
    domain: string;
    /** Context text safe to pass to a model. */
    text: string;
    sourceText: string;
    agenticTrust: AgenticTrustMetadata;
}
export interface AgentMiddlewareState {
    messages?: unknown[];
    [key: string]: unknown;
}
export interface ModelCallRequest {
    messages?: unknown[];
    state?: {
        messages?: unknown[];
    };
    [key: string]: unknown;
}
export interface ToolCallRequest {
    toolCall?: {
        name?: string;
        args?: unknown;
        arguments?: unknown;
    };
    [key: string]: unknown;
}
type VerifyFn = (target: string) => Promise<AgenticTrustMetadata>;
export interface AgenticTrustLangChainMiddleware {
    /** Hook name consumed by LangChain `createMiddleware`. */
    name: "agenticTrust";
    beforeModel(state: AgentMiddlewareState): Promise<{
        messages: unknown[];
    } | undefined>;
    wrapModelCall<T>(request: ModelCallRequest, handler: (request: ModelCallRequest) => T | Promise<T>): Promise<T>;
    wrapToolCall<T>(request: ToolCallRequest, handler: (request: ToolCallRequest) => T | Promise<T>): Promise<T>;
    loadLlmsContext(source: LlmsContextSource): Promise<VerifiedLlmsContext>;
}
export declare function createVerifier(options?: AgenticTrustLangChainOptions): VerifyFn;
export declare function isStrictMode(options?: AgenticTrustLangChainOptions): boolean;
/**
 * LangChain.js agent middleware.
 *
 * Pass the result to `createMiddleware` from `langchain`. The default mode is
 * `"audit"`: unsigned context logs
 * `[AgenticTrust Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.`
 * and does not throw. `{ strict: true }` or `{ mode: "strict" }` throws
 * `UnverifiedDomainContextError` before any `llms.txt` body is read or parsed.
 */
export declare function agenticTrustLangChainMiddleware(options?: AgenticTrustLangChainOptions): AgenticTrustLangChainMiddleware;
/** Verify with the SDK, then parse `llms.txt`. The body is untouched when verification fails. */
export declare function loadVerifiedLlmsContext(source: LlmsContextSource, options?: AgenticTrustLangChainOptions): Promise<VerifiedLlmsContext>;
/**
 * Verify a domain. Strict mode throws `UnverifiedDomainContextError`.
 * Audit mode (the default) returns the metadata and emits the security alert.
 */
export declare function assertVerifiedDomain(target: string, options?: AgenticTrustLangChainOptions): Promise<AgenticTrustMetadata>;
export {};
//# sourceMappingURL=middleware.d.ts.map