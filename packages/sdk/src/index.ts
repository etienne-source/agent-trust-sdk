/**
 * **Trustflow** open-standard SDK (`@trustflow/sdk`).
 *
 * Cryptographic protocol for domain identity: DID signatures (`did:web` + compact JWS).
 * The CLI package is `@trustflow/cli`
 * (`npx @trustflow/cli@latest init`), which registers domains with Trustflow Systems.
 * There is no unscoped `trustflow` package. After install, the command name is `trustflow`.
 *
 * ```bash
 * npm install @trustflow/sdk
 * ```
 *
 * Do not install `trustflow-sdk` (an unrelated logging package). These packages
 * publish as `@trustflow/*` because the npm scope `@agentic-trust` is taken by an
 * unrelated maintainer. The previous package name `agent-trust-sdk` is now
 * `@trustflow/sdk`.
 *
 * DID JWS proofs verify only for `EdDSA` (Ed25519) and `ES256`. The signed payload must
 * bind the verification key, services, and assertion methods in the published document.
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
export type { MemoryCacheOptions } from "./cache.js";
export {
  normalizeDomain,
  didWebId,
  wellKnownDidUrl,
  wellKnownLlmsUrl,
  rootLlmsUrl,
  secureApiBase,
  assertHttpsEndpoint,
  sameSiteRedirect,
} from "./tls.js";
export {
  importPublicKey,
  verifyDidJws,
  allowedAlgForKey,
  ALLOWED_JWS_ALGS,
} from "./jws.js";
export type { AllowedJwsAlg } from "./jws.js";
export { createSignedDidDocument, hashLlmsTxt, hashPublicKeyPem, publicKeyPemFromPrivate } from "./identity.js";
export { alignLlmsTxt, assertLlmsTxtDomain, llmsTxtDomains, renderLlmsManifest } from "./llmsManifest.js";
export type { LlmsManifestInput } from "./llmsManifest.js";
export type { CreateSignedDidInput, DidServiceEndpoint, SignedDidIdentity } from "./identity.js";
export { signBuildArtifacts, renewBuildSignatures, resolvePublishedLlms } from "./buildSign.js";
export type {
  BuildSignatureFile,
  PublishedLlms,
  RenewBuildSignaturesOptions,
  RenewBuildSignaturesResult,
  SignBuildArtifactsInput,
  SignBuildArtifactsResult,
} from "./buildSign.js";
export type {
  VerificationStatus,
  DomainClaims,
  VerifyResult,
  EndpointInspectionResult,
  DidDocument,
  VerifyDomainOptions,
} from "./types.js";
