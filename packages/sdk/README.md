# @agentic-trust/sdk

AgenticTrust open-standard TypeScript client. It verifies domain identity with DID signatures (`did:web` + JWS) before an AI agent executes a tool or MCP endpoint.

The hosted registry is **Trustflow Systems** ([trustflow.systems](https://trustflow.systems)). Scaffold a domain with the CLI package `@agentic-trust/cli` (`npx agentic-trust init`).

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Do not install `trustflow-sdk`.** `npm install trustflow-sdk` points at an unrelated logging package. Install this SDK from GitHub: `github:etienne-source/agent-trust-sdk`.

## Install

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk
```

Until then, clone the repository and use the workspace package `@agentic-trust/sdk`. npm cannot install this workspace path from a git URL.

## Migration

| Previous | Current |
|----------|---------|
| `agent-trust-sdk` | `@agentic-trust/sdk` |
| `@trustflow/sdk` | `@agentic-trust/sdk` |
| `npx trustflow init` | `npx agentic-trust init` |

## Quick start

```ts
import {
  verifyDomain,
  inspectEndpointBeforeExecution,
  clearVerifyCache,
} from "@agentic-trust/sdk";

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
import { agenticTrustMiddleware } from "@agentic-trust/sdk";

const trust = agenticTrustMiddleware();
const context = await trust.annotateContext({ snippet }, "https://example.com");
const response = await trust.fetch("https://example.com/data.json");
const tool = trust.wrapTool(existingTool);
```

Point the fallback registry at Trustflow Systems:

```bash
export VERIFICATION_API_URL=https://api.trustflow.systems
```

That calls `GET /v1/verify?domain=`. The SDK only performs HTTPS fetches. It has no database client.

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
hashPublicKeyPem(pem): string
normalizeDomain, didWebId, wellKnownDidUrl, verifyDidJws, ...
```

`createSignedDidDocument` returns the private key to the caller. The CLI writes it under `.agentic-trust/` and gitignores that directory.

A proof with `alg: none`, `HS*`, or any other disallowed algorithm is `RISK` and is not upgraded by the registry.

## License

MIT
