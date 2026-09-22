import { defaultCache, type MemoryCache } from "./cache.js";
import { assessDidDocument, fetchDidDocument } from "./localDid.js";
import { didWebId, normalizeDomain } from "./tls.js";
import type { VerificationStatus, VerifyResult } from "./types.js";

/** Registry used when no base URL is configured. */
export const DEFAULT_TRUST_API_URL = "https://api.trustflow.systems";

/** Verification calls abort after this long so a slow registry cannot stall an agent. */
export const DEFAULT_MIDDLEWARE_TIMEOUT_MS = 4_000;

/**
 * Successful registry answers are cached briefly.
 * Longer-lived entries written by `verifyDomain` are still reused.
 */
export const DEFAULT_MIDDLEWARE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Transport failures are cached for a shorter window so a down API is not hammered. */
const FAILURE_CACHE_TTL_MS = 15_000;

const HEADER_NAME = "x-agentic-trust";
const WARNING_HEADER_NAME = "x-agentic-trust-warning";

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

type ToolMethod = (this: unknown, input: unknown, ...rest: unknown[]) => unknown;

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
  annotateContext<T extends Record<string, unknown>>(
    context: T,
    target: string
  ): Promise<T & { agenticTrust: AgenticTrustMetadata; securityWarning?: true }>;
  /**
   * Annotate LangChain-style documents using `metadata.source` (or `metadata.url`).
   */
  annotateDocuments<D extends LangChainLikeDocument>(
    documents: D[],
    fallbackUrl?: string
  ): Promise<D[]>;
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

interface ResolvedOptions {
  apiBase: string;
  timeoutMs: number;
  cacheTtlMs: number;
  bypassCache: boolean;
  fetchImpl: typeof globalThis.fetch;
  headerName: string;
  cache: MemoryCache;
}

interface Lookup {
  meta: AgenticTrustMetadata;
  /** How long this answer may be cached. `0` means do not store it. */
  cacheTtlMs: number;
}

function envUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const value = process.env?.AGENTIC_TRUST_API_URL || process.env?.VERIFICATION_API_URL;
  return value && value.trim() ? value.trim() : undefined;
}

function resolveOptions(options: AgenticTrustMiddlewareOptions = {}): ResolvedOptions {
  const apiBase = (options.verificationApiUrl ?? envUrl() ?? DEFAULT_TRUST_API_URL).replace(
    /\/$/,
    ""
  );
  return {
    apiBase,
    timeoutMs: options.timeoutMs ?? DEFAULT_MIDDLEWARE_TIMEOUT_MS,
    cacheTtlMs: options.cacheTtlMs ?? DEFAULT_MIDDLEWARE_CACHE_TTL_MS,
    bypassCache: options.bypassCache ?? false,
    fetchImpl: options.fetch ?? globalThis.fetch.bind(globalThis),
    headerName: options.headerName ?? HEADER_NAME,
    cache: options.cache ?? defaultCache,
  };
}

export function domainFromTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Empty verification target");
  }
  if (/^did:web:/i.test(trimmed)) {
    const host = trimmed.slice("did:web:".length).split(":")[0]?.trim().toLowerCase();
    if (!host) throw new Error("Invalid did:web");
    return host;
  }
  return normalizeDomain(trimmed);
}

function readTrustScore(body: Record<string, unknown>): number | undefined {
  const claims =
    body.claims && typeof body.claims === "object"
      ? (body.claims as Record<string, unknown>)
      : {};
  const candidates = [
    body.trustScore,
    body.trust_score,
    body.score,
    claims.trustScore,
    claims.trust_score,
    claims.score,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim() && Number.isFinite(Number(candidate))) {
      return Number(candidate);
    }
  }
  return undefined;
}

function readDid(body: Record<string, unknown>, domain: string, verified: boolean): string | undefined {
  const claims =
    body.claims && typeof body.claims === "object"
      ? (body.claims as Record<string, unknown>)
      : {};
  if (typeof body.did === "string" && body.did) return body.did;
  if (typeof claims.did === "string" && claims.did) return claims.did;
  return verified ? didWebId(domain) : undefined;
}

function unverified(
  domain: string,
  warning: string,
  status: VerificationStatus = "UNVERIFIED",
  did?: string
): AgenticTrustMetadata {
  return {
    verified: false,
    securityWarning: true,
    warning,
    domain,
    status,
    ...(did ? { did } : {}),
  };
}

function isVerifiedStatus(body: Record<string, unknown>): boolean {
  const statusRaw = typeof body.status === "string" ? body.status.toUpperCase() : "";
  if (statusRaw === "VERIFIED") return true;
  if (statusRaw === "UNVERIFIED" || statusRaw === "RISK") return false;
  return body.verified === true;
}

function metadataFromRegistry(
  domain: string,
  body: Record<string, unknown>
): AgenticTrustMetadata {
  const statusRaw = typeof body.status === "string" ? body.status.toUpperCase() : "";
  const verified = isVerifiedStatus(body);
  const trustScore = readTrustScore(body);
  const did = readDid(body, domain, verified);
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  if (verified) {
    return {
      verified: true,
      ...(trustScore !== undefined ? { trustScore } : {}),
      domain,
      status: "VERIFIED",
      ...(did ? { did } : {}),
    };
  }

  const status: VerificationStatus = statusRaw === "RISK" ? "RISK" : "UNVERIFIED";
  return unverified(
    domain,
    reason ?? (status === "RISK" ? "Domain marked RISK" : "Domain is not verified"),
    status,
    did
  );
}

function metadataFromCached(result: VerifyResult): AgenticTrustMetadata {
  return metadataFromRegistry(result.domain, {
    status: result.status,
    reason: result.reason,
    claims: result.claims,
    did: result.claims.did,
    trustScore: result.claims.trustScore,
    trust_score: result.claims.trust_score,
    score: result.claims.score,
  });
}

function toCacheValue(meta: AgenticTrustMetadata): VerifyResult {
  return {
    status: meta.status,
    domain: meta.domain,
    claims: {
      ...(meta.did ? { did: meta.did } : {}),
      ...(meta.trustScore !== undefined ? { trustScore: meta.trustScore } : {}),
    },
    reason: meta.warning,
    cached: false,
    checkedAt: new Date().toISOString(),
  };
}

function cacheKeys(domain: string): { sdk: string; middleware: string } {
  return { sdk: `verify:${domain}`, middleware: `mw:verify:${domain}` };
}

function readCache(domain: string, options: ResolvedOptions): AgenticTrustMetadata | undefined {
  if (options.bypassCache) return undefined;
  const keys = cacheKeys(domain);
  const sdkHit = options.cache.get(keys.sdk);
  if (sdkHit) return metadataFromCached(sdkHit);
  const middlewareHit = options.cache.get(keys.middleware);
  if (middlewareHit) return metadataFromCached(middlewareHit);
  return undefined;
}

function errorWarning(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return "Verification timed out; treating domain as unverified";
    }
    return `Verification unavailable: ${err.message}`;
  }
  return "Verification unavailable";
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * Local `did:web` check. `null` means "not authoritative" — caller pings the registry.
 * RISK and VERIFIED are terminal. Abort errors propagate so the caller fail-closes.
 */
async function lookupLocalDid(
  domain: string,
  options: ResolvedOptions,
  signal: AbortSignal
): Promise<Lookup | null> {
  const loaded = await fetchDidDocument(domain, options.fetchImpl, signal);
  if (loaded.kind === "network") {
    if (signal.aborted || isAbortError(loaded.error)) throw loaded.error;
    return null;
  }
  if (loaded.kind === "http") return null;
  if (loaded.kind === "invalid-json") {
    return {
      meta: unverified(domain, "did.json is not valid JSON", "RISK"),
      cacheTtlMs: options.cacheTtlMs,
    };
  }

  const assessment = await assessDidDocument(domain, loaded.body);
  if (assessment.outcome === "malformed") {
    return {
      meta: unverified(domain, assessment.reason, "RISK"),
      cacheTtlMs: options.cacheTtlMs,
    };
  }
  if (assessment.outcome === "incomplete") return null;
  if (assessment.outcome === "risk") {
    return {
      meta: unverified(domain, assessment.reason, "RISK", assessment.didId),
      cacheTtlMs: options.cacheTtlMs,
    };
  }

  const trustScore = readTrustScore(assessment.record);
  return {
    meta: {
      verified: true,
      ...(trustScore !== undefined ? { trustScore } : {}),
      domain,
      status: "VERIFIED",
      did: assessment.didId,
    },
    cacheTtlMs: options.cacheTtlMs,
  };
}

async function lookupApi(
  domain: string,
  options: ResolvedOptions,
  signal: AbortSignal
): Promise<Lookup> {
  const did = didWebId(domain);
  const url = `${options.apiBase}/v1/verify?domain=${encodeURIComponent(domain)}&did=${encodeURIComponent(did)}`;
  try {
    const response = await options.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      const transient = response.status >= 500;
      return {
        meta: unverified(domain, `Verification API HTTP ${response.status}`),
        cacheTtlMs: transient ? Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS) : options.cacheTtlMs,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        meta: unverified(domain, "Verification API returned invalid JSON"),
        cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
      };
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        meta: unverified(domain, "Verification API returned an unexpected payload"),
        cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
      };
    }

    return {
      meta: metadataFromRegistry(domain, body as Record<string, unknown>),
      cacheTtlMs: options.cacheTtlMs,
    };
  } catch (err) {
    return {
      meta: unverified(domain, errorWarning(err)),
      cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
    };
  }
}

async function lookupTrust(domain: string, options: ResolvedOptions): Promise<Lookup> {
  const cached = readCache(domain, options);
  if (cached) return { meta: cached, cacheTtlMs: 0 };

  const signal = AbortSignal.timeout(options.timeoutMs);
  try {
    const local = await lookupLocalDid(domain, options, signal);
    if (local) return local;
  } catch (err) {
    return {
      meta: unverified(domain, errorWarning(err)),
      cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
    };
  }

  if (signal.aborted) {
    return {
      meta: unverified(domain, "Verification timed out; treating domain as unverified"),
      cacheTtlMs: Math.min(options.cacheTtlMs, FAILURE_CACHE_TTL_MS),
    };
  }

  return lookupApi(domain, options, signal);
}

const inflight = new WeakMap<ResolvedOptions, Map<string, Promise<AgenticTrustMetadata>>>();

async function settle(domain: string, options: ResolvedOptions): Promise<AgenticTrustMetadata> {
  const lookup = await lookupTrust(domain, options);
  if (lookup.cacheTtlMs > 0) {
    options.cache.set(cacheKeys(domain).middleware, toCacheValue(lookup.meta), lookup.cacheTtlMs);
  }
  return lookup.meta;
}

async function verifyWithOptions(
  target: string,
  options: ResolvedOptions
): Promise<AgenticTrustMetadata> {
  let domain: string;
  try {
    domain = domainFromTarget(target);
  } catch (err) {
    const label = target.trim() || "(empty)";
    return unverified(label, err instanceof Error ? err.message : "Invalid verification target");
  }

  if (options.bypassCache) return settle(domain, options);

  let existing = inflight.get(options);
  if (!existing) {
    existing = new Map();
    inflight.set(options, existing);
  }
  const bucket = existing;
  const pending = bucket.get(domain);
  if (pending) return pending;

  const promise = settle(domain, options).finally(() => {
    if (bucket.get(domain) === promise) bucket.delete(domain);
  });
  bucket.set(domain, promise);
  return promise;
}

function compactHeader(meta: AgenticTrustMetadata): string {
  const payload: Record<string, unknown> = { verified: meta.verified };
  if (meta.verified && meta.trustScore !== undefined) payload.trustScore = meta.trustScore;
  if (meta.securityWarning) payload.securityWarning = true;
  return JSON.stringify(payload);
}

function enrichPayload(parsed: unknown, meta: AgenticTrustMetadata): unknown {
  const agenticTrust = meta;
  const warning = meta.securityWarning ? { securityWarning: true as const } : {};
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>), agenticTrust, ...warning };
  }
  return { data: parsed, agenticTrust, ...warning };
}

async function applyMetadata(
  response: Response,
  meta: AgenticTrustMetadata,
  headerName: string
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set(headerName, compactHeader(meta));
  if (meta.securityWarning) headers.set(WARNING_HEADER_NAME, "true");

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = /json/i.test(contentType);
  if (!isJson || response.status === 204 || response.status === 205) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const text = await response.text();
  headers.delete("content-length");
  let parsed: unknown;
  try {
    parsed = text.length ? JSON.parse(text) : null;
  } catch {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return new Response(JSON.stringify(enrichPayload(parsed, meta)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function hostnameOf(url: string): string | undefined {
  try {
    return domainFromTarget(url);
  } catch {
    return undefined;
  }
}

function stricter(primary: AgenticTrustMetadata, other: AgenticTrustMetadata): AgenticTrustMetadata {
  if (!primary.verified) return primary;
  if (!other.verified) return other;
  return primary;
}

const SOURCE_KEYS = ["url", "href", "domain", "endpoint", "link", "source", "pageUrl"];

function extractTarget(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed) || /^did:web:/i.test(trimmed)) return trimmed;
    return undefined;
  }
  if (!value || typeof value !== "object" || depth > 2) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of SOURCE_KEYS) {
    const found = extractTarget(record[key], depth + 1);
    if (found) return found;
  }
  if (record.metadata) {
    const found = extractTarget(record.metadata, depth + 1);
    if (found) return found;
  }
  if (record.input) {
    const found = extractTarget(record.input, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function mergeResult(result: unknown, meta: AgenticTrustMetadata): unknown {
  if (Array.isArray(result) && result.every((item) => item && typeof item === "object" && "pageContent" in item)) {
    return result.map((item) => mergeResult(item, meta));
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    if (typeof record.pageContent === "string") {
      const metadata =
        record.metadata && typeof record.metadata === "object"
          ? (record.metadata as Record<string, unknown>)
          : {};
      return {
        ...record,
        metadata: {
          ...metadata,
          agenticTrust: meta,
          ...(meta.securityWarning ? { securityWarning: true } : {}),
        },
      };
    }
    return enrichPayload(record, meta);
  }
  if (typeof result === "string") {
    return enrichPayload({ content: result }, meta);
  }
  return enrichPayload({ result }, meta);
}

function methodOf(tool: object, name: string): ToolMethod | undefined {
  const value = (tool as Record<string, unknown>)[name];
  return typeof value === "function" ? (value as ToolMethod) : undefined;
}

function wrapMethod(method: ToolMethod, tool: object, options: ResolvedOptions): ToolMethod {
  return async function wrapped(input: unknown, ...rest: unknown[]) {
    const result = await method.call(tool, input, ...rest);
    const target = extractTarget(input) ?? extractTarget(result);
    if (!target) return result;
    const meta = await verifyWithOptions(target, options);
    return mergeResult(result, meta);
  };
}

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
export function agenticTrustMiddleware(
  options: AgenticTrustMiddlewareOptions = {}
): AgenticTrustMiddleware {
  const resolved = resolveOptions(options);

  const fetchWithTrust: AgenticTrustMiddleware["fetch"] = async (input, init) => {
    const requested = requestUrl(input);
    const requestedHost = hostnameOf(requested);
    // Relative or unparseable URLs have no registry domain. Pass them through.
    if (!requestedHost) {
      return resolved.fetchImpl(input, init);
    }

    const verifyPromise = verifyWithOptions(requested, resolved);
    const response = await resolved.fetchImpl(input, init);
    let meta = await verifyPromise;

    const finalHost = response.url ? hostnameOf(response.url) : undefined;
    if (finalHost && finalHost !== meta.domain) {
      meta = stricter(meta, await verifyWithOptions(finalHost, resolved));
    }
    return applyMetadata(response, meta, resolved.headerName);
  };

  return {
    verify(target) {
      return verifyWithOptions(target, resolved);
    },
    async annotateContext(context, target) {
      const meta = await verifyWithOptions(target, resolved);
      return {
        ...context,
        agenticTrust: meta,
        ...(meta.securityWarning ? { securityWarning: true as const } : {}),
      };
    },
    async annotateDocuments<D extends LangChainLikeDocument>(documents: D[], fallbackUrl?: string) {
      return Promise.all(
        documents.map(async (doc) => {
          const target = extractTarget(doc.metadata) ?? extractTarget(doc) ?? fallbackUrl;
          const meta = target
            ? await verifyWithOptions(target, resolved)
            : unverified("unknown", "Document has no source URL to verify");
          const metadata = {
            ...(doc.metadata ?? {}),
            agenticTrust: meta,
            ...(meta.securityWarning ? { securityWarning: true } : {}),
          };
          return { ...doc, metadata } as D;
        })
      );
    },
    fetch: fetchWithTrust,
    wrapTool(tool) {
      const invoke = methodOf(tool, "invoke");
      const call = methodOf(tool, "call");
      const execute = methodOf(tool, "execute");
      if (!invoke && !call && !execute) return tool;
      return new Proxy(tool, {
        get(target, prop, receiver) {
          if (prop === "invoke" && invoke) return wrapMethod(invoke, target, resolved);
          if (prop === "call" && call) return wrapMethod(call, target, resolved);
          if (prop === "execute" && execute) return wrapMethod(execute, target, resolved);
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };
}
