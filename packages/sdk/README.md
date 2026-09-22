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
createSignedDidDocument(input): Promise<SignedDidIdentity>
hashPublicKeyPem(pem): string
normalizeDomain, didWebId, wellKnownDidUrl, verifyDidJws, ...
```

`createSignedDidDocument` returns the private key to the caller. The CLI writes it under `.agentic-trust/` and gitignores that directory.

## License

MIT
