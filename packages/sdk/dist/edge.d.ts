/**
 * Edge and browser entry for `@agentic-trust/sdk/edge`.
 *
 * Domain helpers only. This module does not import `jose`, `node:crypto`,
 * or `node:fs`, so a minified client bundle stays under 10KB.
 * Signing and `verifyDomain` stay on the main `@agentic-trust/sdk` entry.
 */
export { assertHttpsEndpoint, didWebId, normalizeDomain, wellKnownDidUrl, wellKnownLlmsUrl, } from "./tls.js";
//# sourceMappingURL=edge.d.ts.map