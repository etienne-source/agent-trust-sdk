/**
 * **Trustflow** Vercel build hook (`@trustflow/vercel-plugin`).
 *
 * During a Vercel or Next.js build, signs `llms.txt` and writes
 * `.well-known/did.json` from `AGENTIC_TRUST_PRIVATE_KEY`. The private key
 * stays in the host environment. This package does not prompt and does not
 * commit key material.
 *
 * The hosted registry is Trustflow Systems. Do not install `trustflow-sdk`.
 *
 * @packageDocumentation
 */
export {
  AGENTIC_TRUST_VERCEL_BIN,
  agenticTrustBuildCommand,
  runAgenticTrustVercelBuild,
  withAgenticTrustVercelConfig,
} from "./build.js";
export type {
  AgenticTrustVercelArtifact,
  AgenticTrustVercelBuildOptions,
  AgenticTrustVercelBuildResult,
  AgenticTrustVercelConfig,
} from "./build.js";
