/**
 * **AgenticTrust** open-standard SDK (`@trustflow/sdk`).
 *
 * Cryptographic protocol for domain identity: DID signatures (`did:web` + compact JWS).
 * The CLI package is `@trustflow/cli`
 * (`npx trustflow init`), which registers domains with Trustflow Systems.
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
 * `trustflow-sdk` (an unrelated logging package). These packages publish as
 * `@trustflow/*` because the npm scope `@agentic-trust` is taken by an
 * unrelated maintainer. The previous package name `agent-trust-sdk` is now
 * `@trustflow/sdk`. The CLI command is `npx trustflow init`.
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
export type { MemoryCacheOptions } from "./cache.js";
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
  clearPublicKeyCache,
  ALLOWED_JWS_ALGS,
} from "./jws.js";
export type { AllowedJwsAlg } from "./jws.js";
export { createSignedDidDocument, hashPublicKeyPem, publicKeyPemFromPrivate } from "./identity.js";
export type { CreateSignedDidInput, DidServiceEndpoint, SignedDidIdentity } from "./identity.js";
export { signBuildArtifacts, renewBuildSignatures } from "./buildSign.js";
export type {
  BuildSignatureFile,
  RenewBuildSignaturesOptions,
  RenewBuildSignaturesResult,
  SignBuildArtifactsInput,
  SignBuildArtifactsResult,
} from "./buildSign.js";
export {
  emitSecurityAlert,
  resolveEnforcementMode,
  securityAlertEvent,
  subscribeSecurityAlerts,
  unverifiedContextAlert,
} from "./audit.js";
export type {
  AgenticTrustEnforcementMode,
  AgenticTrustSecurityEvent,
  EnforcementOptions,
} from "./audit.js";
export {
  notifyVerifiedDomain,
  isCompleteVerification,
  buildVerifiedNotifyPayload,
  VERIFIED_NOTIFY_ENV,
  VERIFIED_SCORE_COMPLETE,
} from "./verifiedNotify.js";
export type {
  VerifiedDomainNotice,
  NotifyVerifiedDomainOptions,
  NotifyVerifiedDomainResult,
  VerifiedNotifyPayload,
  NotifyVerifiedReason,
} from "./verifiedNotify.js";
export type {
  VerificationStatus,
  DomainClaims,
  VerifyResult,
  EndpointInspectionResult,
  DidDocument,
  VerifyDomainOptions,
} from "./types.js";
