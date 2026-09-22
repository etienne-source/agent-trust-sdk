import {
  agenticTrustMiddleware,
  type AgenticTrustMetadata,
  type AgenticTrustMiddlewareOptions,
} from "@agentic-trust/sdk";
import { UnverifiedDomainContextError } from "./error.js";
import {
  cloneValue,
  collectContextTargets,
  collectLlmsPayloads,
  formatVerifiedLlms,
  parseLlmsTxt,
  readBody,
  writeVerifiedText,
  type ParsedLlmsTxt,
} from "./llms.js";

export interface AgenticTrustLangChainOptions extends AgenticTrustMiddlewareOptions {
  /**
   * Domain check. When omitted, the package calls `agenticTrustMiddleware`
   * from `@agentic-trust/sdk` (the verify/sign implementation).
   */
  verify?: (target: string) => Promise<AgenticTrustMetadata>;
  /**
   * Fail closed by default. Unverified or tampered `llms.txt` throws
   * `UnverifiedDomainContextError` and the model or tool does not run.
   * Set `false` to continue without parsing that payload.
   */
  failClosed?: boolean;
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
  state?: { messages?: unknown[] };
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
  beforeModel(state: AgentMiddlewareState): Promise<{ messages: unknown[] } | undefined>;
  wrapModelCall<T>(request: ModelCallRequest, handler: (request: ModelCallRequest) => T | Promise<T>): Promise<T>;
  wrapToolCall<T>(request: ToolCallRequest, handler: (request: ToolCallRequest) => T | Promise<T>): Promise<T>;
  loadLlmsContext(source: LlmsContextSource): Promise<VerifiedLlmsContext>;
}

function sdkOptions(options: AgenticTrustLangChainOptions): AgenticTrustMiddlewareOptions {
  const rest: AgenticTrustMiddlewareOptions & { verify?: VerifyFn; failClosed?: boolean } = {
    ...options,
  };
  delete rest.verify;
  delete rest.failClosed;
  return rest;
}

export function createVerifier(options: AgenticTrustLangChainOptions = {}): VerifyFn {
  if (options.verify) return options.verify;
  const trust = agenticTrustMiddleware(sdkOptions(options));
  return (target) => trust.verify(target);
}

export function isFailClosed(options: { failClosed?: boolean } = {}): boolean {
  return options.failClosed !== false;
}

export async function requireVerifiedDomain(
  target: string,
  verify: VerifyFn
): Promise<AgenticTrustMetadata> {
  const meta = await verify(target);
  if (!meta.verified || meta.securityWarning) {
    throw new UnverifiedDomainContextError(meta);
  }
  return meta;
}

async function checkDomain(
  target: string,
  verify: VerifyFn,
  failClosed: boolean
): Promise<AgenticTrustMetadata> {
  if (failClosed) return requireVerifiedDomain(target, verify);
  return verify(target);
}

function trusted(meta: AgenticTrustMetadata | undefined): meta is AgenticTrustMetadata {
  return Boolean(meta && meta.verified && !meta.securityWarning);
}

async function rewriteVerified<T>(value: T, verify: VerifyFn, failClosed: boolean): Promise<T> {
  const sites = collectLlmsPayloads(value);
  const targets = new Set<string>(collectContextTargets(value));
  for (const site of sites) targets.add(site.target);
  if (targets.size === 0) return value;

  const metas = new Map<string, AgenticTrustMetadata>();
  for (const target of targets) {
    metas.set(target, await checkDomain(target, verify, failClosed));
  }
  if (sites.length === 0) return value;

  const draft = cloneValue(value);
  let wrote = false;
  for (const site of sites) {
    const meta = metas.get(site.target);
    if (!trusted(meta)) continue;
    writeVerifiedText(draft, site.path, formatVerifiedLlms(parseLlmsTxt(site.readContent()), meta));
    wrote = true;
  }
  return wrote ? draft : value;
}

async function readVerified(source: LlmsContextSource, verify: VerifyFn): Promise<VerifiedLlmsContext> {
  const meta = await requireVerifiedDomain(source.target, verify);
  const sourceText = readBody(source.content);
  const parsed = parseLlmsTxt(sourceText);
  return {
    target: source.target,
    domain: meta.domain,
    ...parsed,
    text: formatVerifiedLlms(parsed, meta),
    sourceText,
    agenticTrust: meta,
  };
}

/**
 * LangChain.js agent middleware.
 *
 * Pass the result to `createMiddleware` from `langchain`. `beforeModel`,
 * `wrapModelCall`, and `wrapToolCall` call `@agentic-trust/sdk` and throw
 * `UnverifiedDomainContextError` before any `llms.txt` body is read or parsed.
 * That block is the default (`failClosed: true`). The error message is the
 * AgenticTrust context-poisoning security error.
 */
export function agenticTrustLangChainMiddleware(
  options: AgenticTrustLangChainOptions = {}
): AgenticTrustLangChainMiddleware {
  const verify = createVerifier(options);
  const failClosed = isFailClosed(options);

  return {
    name: "agenticTrust",
    async beforeModel(state) {
      if (!state || !Array.isArray(state.messages)) return undefined;
      const messages = await rewriteVerified(state.messages, verify, failClosed);
      if (messages === state.messages) return undefined;
      return { messages };
    },
    async wrapModelCall(request, handler) {
      return handler(await rewriteVerified(request, verify, failClosed));
    },
    async wrapToolCall(request, handler) {
      return handler(await rewriteVerified(request, verify, failClosed));
    },
    loadLlmsContext(source) {
      return readVerified(source, verify);
    },
  };
}

/** Verify with the SDK, then parse `llms.txt`. The body is untouched when verification fails. */
export async function loadVerifiedLlmsContext(
  source: LlmsContextSource,
  options: AgenticTrustLangChainOptions = {}
): Promise<VerifiedLlmsContext> {
  return readVerified(source, createVerifier(options));
}

/** Verify a domain and throw `UnverifiedDomainContextError` when it is not signed. */
export async function assertVerifiedDomain(
  target: string,
  options: AgenticTrustLangChainOptions = {}
): Promise<AgenticTrustMetadata> {
  return requireVerifiedDomain(target, createVerifier(options));
}
