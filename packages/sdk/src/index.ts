/**
 * **AgenticTrust** open-standard SDK (`@agentic-trust/sdk`).
 *
 * Cryptographic protocol for domain identity: DID signatures (`did:web` + compact JWS)
 * and SDK integrations for AI agents. The CLI package is `@agentic-trust/cli`
 * (`npx agentic-trust init`), which registers domains with Trustflow Systems.
 *
 * Git-only install until the npm scope exists. Clone this repository so the
 * workspace package resolves, or, once `packages/sdk` is on the default branch:
 *
 * ```bash
 * pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk
 * ```
 *
 * Do not `npm install github:etienne-source/agent-trust-sdk` against the
 * repository root: that package is the private workspace. Do not install
 * `trustflow-sdk` (unrelated logging package) or run `npx trustflow init`.
 * Previous names `agent-trust-sdk` and `@trustflow/sdk` migrate to `@agentic-trust/sdk`.
 *
 * DID JWS proofs verify only for `EdDSA` (Ed25519) and `ES256`.
 * `alg: "none"`, symmetric `HS*` algorithms, a missing `alg`, and every other algorithm are rejected.
 *
 * @packageDocumentation
 */
export { verifyDomain, inspectEndpointBeforeExecution, clearVerifyCache } from "./verifyDomain.js";
export {
  agenticTrustMiddleware,
  DEFAULT_TRUST_API_URL,
  DEFAULT_MIDDLEWARE_TIMEOUT_MS,
  DEFAULT_MIDDLEWARE_CACHE_TTL_MS,
} from "./agenticTrustMiddleware.js";
export type {
  AgenticTrustMetadata,
  AgenticTrustMiddleware,
  AgenticTrustMiddlewareOptions,
  LangChainLikeDocument,
} from "./agenticTrustMiddleware.js";
export { MemoryCache, defaultCache } from "./cache.js";
export {
  normalizeDomain,
  didWebId,
  wellKnownDidUrl,
  wellKnownLlmsUrl,
  assertHttpsEndpoint,
} from "./tls.js";
export {
  importPublicKey,
  verifyDidJws,
  fingerprintPem,
  allowedAlgForKey,
  ALLOWED_JWS_ALGS,
} from "./jws.js";
export type { AllowedJwsAlg } from "./jws.js";
export { createSignedDidDocument, hashPublicKeyPem, publicKeyPemFromPrivate } from "./identity.js";
export type { CreateSignedDidInput, DidServiceEndpoint, SignedDidIdentity } from "./identity.js";
export type {
  VerificationStatus,
  DomainClaims,
  VerifyResult,
  EndpointInspectionResult,
  DidDocument,
  VerifyDomainOptions,
} from "./types.js";
