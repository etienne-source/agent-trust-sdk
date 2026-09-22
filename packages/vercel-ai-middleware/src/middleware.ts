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
  isLlmsTxtUrl,
  parseLlmsTxt,
  readBody,
  writeVerifiedText,
  type ParsedLlmsTxt,
} from "./llms.js";

/** Request header that marks a fetch as domain context even when the path is not `llms.txt`. */
export const AGENTIC_TRUST_CONTEXT_HEADER = "x-agentic-trust-context";

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
  transformParams<T>(args: { params: T; type?: "generate" | "stream"; model?: unknown }): Promise<T>;
  wrapGenerate<T>(args: LanguageModelCallArgs<T, unknown>): Promise<T>;
  wrapStream<T>(args: LanguageModelCallArgs<unknown, T>): Promise<T>;
  loadLlmsFromUrl(url: string): Promise<VerifiedLlmsContext>;
}

function sdkOptions(options: AgenticTrustVercelAiOptions): AgenticTrustMiddlewareOptions {
  const rest: AgenticTrustMiddlewareOptions & {
    verify?: VerifyFn;
    contextFetch?: typeof globalThis.fetch;
    failClosed?: boolean;
  } = { ...options };
  delete rest.verify;
  delete rest.contextFetch;
  delete rest.failClosed;
  return rest;
}

export function createVerifier(options: AgenticTrustVercelAiOptions = {}): VerifyFn {
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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function headerValue(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const headers = new Headers(init?.headers);
  if (typeof Request !== "undefined" && input instanceof Request) {
    input.headers.forEach((value, key) => {
      if (!headers.has(key)) headers.set(key, value);
    });
  }
  return headers.get(name);
}

function isContextFetch(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = requestUrl(input);
  if (isLlmsTxtUrl(url)) return true;
  const mark = headerValue(input, init, AGENTIC_TRUST_CONTEXT_HEADER);
  return mark === "llms.txt" || mark === "domain";
}

function trustHeader(meta: AgenticTrustMetadata): string {
  return JSON.stringify({
    verified: true,
    domain: meta.domain,
    ...(meta.trustScore !== undefined ? { trustScore: meta.trustScore } : {}),
  });
}

/**
 * Vercel AI SDK fetch and language-model middleware.
 *
 * Pass `fetch` to a provider factory and the object itself to `wrapLanguageModel`.
 * Unverified or tampered domain context throws `UnverifiedDomainContextError`
 * before the response stream starts and before `llms.txt` is parsed.
 * That block is the default (`failClosed: true`).
 */
export function agenticTrustVercelAiMiddleware(
  options: AgenticTrustVercelAiOptions = {}
): AgenticTrustVercelAiMiddleware {
  const verify = createVerifier(options);
  const failClosed = isFailClosed(options);
  const contextFetch = options.contextFetch ?? globalThis.fetch.bind(globalThis);

  const fetchWithTrust: AgenticTrustVercelAiMiddleware["fetch"] = async (input, init) => {
    if (!isContextFetch(input, init)) {
      return contextFetch(input, init);
    }
    const meta = await checkDomain(requestUrl(input), verify, failClosed);
    if (!trusted(meta)) {
      return contextFetch(input, init);
    }
    const response = await contextFetch(input, init);
    const headers = new Headers(response.headers);
    headers.set("x-agentic-trust", trustHeader(meta));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  async function loadLlmsFromUrl(url: string): Promise<VerifiedLlmsContext> {
    const meta = await requireVerifiedDomain(url, verify);
    const response = await contextFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch llms.txt for ${meta.domain}: HTTP ${response.status}`);
    }
    const sourceText = await response.text();
    const parsed = parseLlmsTxt(sourceText);
    return {
      target: url,
      domain: meta.domain,
      ...parsed,
      text: formatVerifiedLlms(parsed, meta),
      sourceText,
      agenticTrust: meta,
    };
  }

  return {
    fetch: fetchWithTrust,
    async transformParams({ params }) {
      return rewriteVerified(params, verify, failClosed);
    },
    async wrapGenerate({ doGenerate, params }) {
      await rewriteVerified(params, verify, failClosed);
      return doGenerate();
    },
    async wrapStream({ doStream, params }) {
      await rewriteVerified(params, verify, failClosed);
      return doStream();
    },
    loadLlmsFromUrl,
  };
}

/** Verify with the SDK, fetch the URL, then parse `llms.txt`. */
export async function loadVerifiedLlmsFromUrl(
  url: string,
  options: AgenticTrustVercelAiOptions = {}
): Promise<VerifiedLlmsContext> {
  return agenticTrustVercelAiMiddleware(options).loadLlmsFromUrl(url);
}

/** Verify a domain and throw `UnverifiedDomainContextError` when it is not signed. */
export async function assertVerifiedDomain(
  target: string,
  options: AgenticTrustVercelAiOptions = {}
): Promise<AgenticTrustMetadata> {
  return requireVerifiedDomain(target, createVerifier(options));
}

export async function readVerifiedLlms(
  source: LlmsContextSource,
  options: AgenticTrustVercelAiOptions = {}
): Promise<VerifiedLlmsContext> {
  const verify = createVerifier(options);
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
