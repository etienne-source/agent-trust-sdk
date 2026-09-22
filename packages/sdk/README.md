# @agentic-trust/sdk

AgenticTrust open-standard TypeScript client. It verifies domain identity with DID signatures (`did:web` + JWS) before an AI agent executes a tool or MCP endpoint.

The hosted registry is **Trustflow Systems** ([trustflow.systems](https://trustflow.systems)). Scaffold a domain with the CLI package `@agentic-trust/cli` (`npx agentic-trust init`).

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Warning:** Do not run `npm install trustflow-sdk`. That npm name is an unrelated logging package.

## Install

```bash
# Once packages/sdk is on the default branch:
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

`agenticTrustMiddleware` wraps LangChain tools (`invoke` / `call`), Vercel AI SDK tools (`execute`), and `fetch`. It calls `GET {base}/v1/verify` (default `https://api.trustflow.systems`) and appends `{ verified: true, trustScore }` when the registry verifies the domain. Otherwise it appends `securityWarning: true` and does not throw, including on timeout (4s) or when the API is down. Lookups reuse the SDK memory cache.

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

## License

MIT
