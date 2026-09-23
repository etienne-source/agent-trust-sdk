# @trustflow/sdk

Trustflow open-standard TypeScript client. It verifies domain identity with DID signatures (`did:web` + JWS) before an AI agent executes a tool or MCP endpoint.

The hosted registry is **Trustflow Systems** ([trustflow.systems](https://trustflow.systems)). Scaffold a domain with `npx @trustflow/cli@latest init`.

**License:** MIT

> **Do not install `trustflow-sdk`.** `npm install trustflow-sdk` points at an unrelated logging package. This package is `@trustflow/sdk`.

## Install

Adopt Trustflow in a project:

```bash
npx @trustflow/cli@latest init
```

Run `npx @trustflow/cli@latest init`. There is no unscoped `trustflow` package. After install, the command name is `trustflow`. Add this library with:

```bash
npm install @trustflow/sdk
```

### Contributors

Clone and `pnpm install` apply only when changing this monorepo. They are not the product install.

## Migration

| Previous | Current |
|----------|---------|
| `agent-trust-sdk` | `@trustflow/sdk` |
| `@agentic-trust/sdk` | `@trustflow/sdk` |
| `npx agentic-trust init` | `npx @trustflow/cli@latest init` |

## Quick start

```ts
import {
  verifyDomain,
  inspectEndpointBeforeExecution,
  clearVerifyCache,
} from "@trustflow/sdk";

const result = await verifyDomain("example.com");
// result.status: "VERIFIED" | "UNVERIFIED" | "RISK"

if (result.status !== "VERIFIED") {
  throw new Error(result.reason ?? `Domain ${result.status}`);
}

const gate = await inspectEndpointBeforeExecution("https://example.com/mcp");
if (!gate.allowed) {
  throw new Error(gate.reason ?? "Endpoint blocked");
}
```

## Demand-side middleware

`agenticTrustMiddleware` wraps LangChain tools (`invoke` / `call`), Vercel AI SDK tools (`execute`), and `fetch`. It verifies local `did:web` (JWS on `/.well-known/did.json`) or calls `GET {base}/v1/verify` (default `https://api.trustflow.systems`). Verified results append `{ verified: true, trustScore }`. Otherwise it appends `securityWarning: true` and does not throw, including on timeout (4s) or when the API is down. Lookups reuse the SDK memory cache.

```ts
import { agenticTrustMiddleware } from "@trustflow/sdk";

const trust = agenticTrustMiddleware();
const context = await trust.annotateContext({ snippet }, "https://example.com");
const response = await trust.fetch("https://example.com/data.json");
const tool = trust.wrapTool(existingTool);
```

`@trustflow/langchain-middleware` and `@trustflow/vercel-ai-middleware` default to audit mode. Unsigned or tampered `llms.txt` does not throw. They warn with `[Trustflow Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.` `{ strict: true }` or `{ mode: "strict" }` throws `UnverifiedDomainContextError` with `[Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.` The SDK helper above still annotates and does not throw.

## Verify cache

`verifyDomain` and `agenticTrustMiddleware` share an in-memory result cache. After the first lookup, a repeat check for the same domain is a cache hit and stays under 5ms. Imported public keys and successful local JWS checks are cached too. A warm `importPublicKey` or `verifyDidJws` stays under 2ms. `clearVerifyCache()` drops those entries and the imported public-key cache. Set `AGENTIC_TRUST_CACHE_DIR` to also keep a JSON copy of public verify results on disk for the next process. That directory must not contain a private key; the cache refuses results that include one. Pass `cache: new MemoryCache({ diskDirectory })` to use a separate store.

## Edge bundle

`@trustflow/sdk/edge` exports domain helpers only (`normalizeDomain`, `didWebId`, `wellKnownDidUrl`, `wellKnownLlmsUrl`, `assertHttpsEndpoint`). It does not import `jose` or Node crypto. The package sets `"sideEffects": false` so bundlers can drop unused main-entry modules.

Measure the minified browser bundle with esbuild (10KB means 10240 bytes of minified ESM, not gzip):

```bash
pnpm --filter @trustflow/sdk bundle:edge
```

`packages/sdk/scripts/measure-edge.mjs` bundles `src/edge.ts` and a client file that imports those helpers. Both results must be under 10KB.

## Build-time signature renewal

`signBuildArtifacts` and `renewBuildSignatures` re-sign `did.json` from `AGENTIC_TRUST_PRIVATE_KEY` during a Vercel or Netlify build. They call `createSignedDidDocument`. The private key is not written, not returned, and not printed.

```ts
import { renewBuildSignatures } from "@trustflow/sdk";

await renewBuildSignatures();
```

Vercel can keep using `@trustflow/vercel-plugin` (`agentic-trust-vercel`), which calls `signBuildArtifacts`. Netlify can call `renewBuildSignatures({ outDir: "dist" })` from the build command. The GitHub composite action `.github/actions/agentic-trust-sign` rotates `public/.well-known/did.json` and `public/llms.txt` and can commit those public files when `commit` is true. It refuses a diff that contains a private key.

Point the fallback registry at Trustflow Systems:

```bash
export VERIFICATION_API_URL=https://api.trustflow.systems
```

That calls `GET /v1/verify?domain=`. The SDK only performs HTTPS fetches. It has no database client.

## Verified-domain webhook

`notifyVerifiedDomain` fires only when the caller reports **100/100 VERIFIED** (`status` `VERIFIED`, `score` `100`, `maxScore` `100` or omitted). It POSTs to `VERIFIED_NOTIFY_WEBHOOK`. It does not query Trustflow and it does not post to X. Sharing on X is a separate explicit step.

```ts
import { notifyVerifiedDomain } from "@trustflow/sdk";

const result = await notifyVerifiedDomain({
  domain: "example.com",
  status: "VERIFIED",
  score: 100,
});
// result.reason: "sent" | "webhook_unset" | "not_complete" | "webhook_rejected" | "request_failed"
```

## Signature algorithms

DID proofs are compact JWS. Verification accepts only:

| `alg` | Key |
|-------|-----|
| `EdDSA` | Ed25519 (`OKP`, `crv` `Ed25519`). This is the JWS name for Ed25519. |
| `ES256` | ECDSA P-256 |

`alg: "none"`, symmetric algorithms (`HS256`, `HS384`, `HS512`), a missing or unreadable `alg`, and every other algorithm are rejected. The check fails closed before the signature is trusted. `createSignedDidDocument` generates an Ed25519 key and can also sign with a supplied P-256 key.

## API surface

```ts
verifyDomain(domainUrl, options?): Promise<VerifyResult>
inspectEndpointBeforeExecution(endpoint, options?): Promise<EndpointInspectionResult>
clearVerifyCache(): void
agenticTrustMiddleware(options?): AgenticTrustMiddleware
// middleware.verify / annotateContext / annotateDocuments / fetch / wrapTool
createSignedDidDocument(input): Promise<SignedDidIdentity>
notifyVerifiedDomain(notice, options?): Promise<NotifyVerifiedDomainResult>
hashPublicKeyPem(pem): string
normalizeDomain, didWebId, wellKnownDidUrl, verifyDidJws, ...
```

`createSignedDidDocument` returns the private key to the caller. The CLI writes it under `.agentic-trust/` and gitignores that directory.

A proof with `alg: none`, `HS*`, or any other disallowed algorithm is `RISK` and is not upgraded by the registry.

## License

MIT
