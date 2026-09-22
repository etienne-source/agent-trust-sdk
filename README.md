# AgenticTrust SDK

`@agentic-trust/sdk` is the open-standard TypeScript client for the **AgenticTrust** cryptographic protocol. It verifies domain identity with DID signatures (`did:web` + JWS) and is the SDK integration used by AI agents and frameworks before tool / MCP execution. Use it to reduce tool poisoning, fake listings, and unverified data.

The open standard and this SDK are **AgenticTrust**. The future CLI package is `@agentic-trust/cli` (not fully built yet).

**License:** MIT · **Package:** `@agentic-trust/sdk` · **Install:** GitHub only

> **Warning:** Do not run `npm install trustflow-sdk`. That npm name is an unrelated logging package.

## Install

The `@agentic-trust` npm scope is not registered yet. This repository's `package.json` name is `@agentic-trust/sdk`, and the only supported install is from Git. That GitHub URL installs the package so imports resolve to `@agentic-trust/sdk`:

```bash
pnpm add github:etienne-source/agent-trust-sdk
npm install github:etienne-source/agent-trust-sdk
# or: yarn add github:etienne-source/agent-trust-sdk
```

## Migration

Function names are unchanged. Install from Git and import `@agentic-trust/sdk`.

| Previous | Current |
|----------|---------|
| `agent-trust-sdk` | `@agentic-trust/sdk` |
| `@trustflow/sdk` | `@agentic-trust/sdk` |
| `import { verifyDomain } from "agent-trust-sdk"` | `import { verifyDomain } from "@agentic-trust/sdk"` |
| `import { verifyDomain } from "@trustflow/sdk"` | `import { verifyDomain } from "@agentic-trust/sdk"` |
| `npx trustflow init` | `npx agentic-trust init` |

## CLI

This package is the verification SDK and does not ship a CLI. The future CLI package is `@agentic-trust/cli`. Developers scaffold a project with:

```bash
npx agentic-trust init
```

Do not use `npx trustflow init`. Install this SDK with the GitHub commands in [Install](#install).

## Quick start

```ts
import {
  verifyDomain,
  inspectEndpointBeforeExecution,
  clearVerifyCache,
} from "@agentic-trust/sdk";

// 1) Verify a business domain (AgenticTrust did:web DID signature + JWS, with optional API fallback)
const result = await verifyDomain("example.com");
// result.status: "VERIFIED" | "UNVERIFIED" | "RISK"
// result.claims: { did, services, llmsTxtPresent, mcpEndpoints, ... }

if (result.status !== "VERIFIED") {
  throw new Error(result.reason ?? `Domain ${result.status}`);
}

// 2) Gate MCP / tool endpoints before the agent runs them
const gate = await inspectEndpointBeforeExecution("https://example.com/mcp");
if (!gate.allowed) {
  throw new Error(gate.reason ?? "Endpoint blocked");
}
```

## How AI frameworks should use it

AgenticTrust SDK integrations:

| Framework / pattern | Integration tip |
|---------------------|-----------------|
| **LangChain / LangGraph** | Wrap tool registration: call `inspectEndpointBeforeExecution` on each tool URL before binding. |
| **OpenAI Agents / function calling** | Before `fetch`/`tools` invocation, `verifyDomain` on the host of any remote tool schema URL. |
| **MCP clients** | On `tools/list` or connect, inspect each `serviceEndpoint`; refuse non-HTTPS or RISK. |
| **Custom agent loops** | Cache-first `verifyDomain` on first contact with a domain; reuse until TTL expires. |

Statuses:

- **VERIFIED** — AgenticTrust `did:web` present and the DID signature (JWS) verifies (and/or central registry confirms)
- **UNVERIFIED** — missing manifest, key, proof, or registry entry
- **RISK** — bad signature, non-`did:web`, or unsafe (e.g. non-HTTPS) endpoint

## Configuration

| Env / option | Purpose |
|--------------|---------|
| `VERIFICATION_API_URL` | Base URL for HTTPS fallback (`GET /v1/verify?domain=`) |
| `options.verificationApiUrl` | Per-call override of the API base |
| `options.cacheTtlMs` | In-memory cache TTL (default 1 hour) |
| `options.bypassCache` | Skip cache for this call |
| `options.fetch` | Inject a custom `fetch` (tests / proxies) |

```bash
export VERIFICATION_API_URL=https://your-verification-api.example
```

See `.env.example`. The SDK only performs HTTPS fetches — it has **no** database,
Prisma, Redis, or SQL clients.

## API surface

```ts
verifyDomain(domainUrl, options?): Promise<VerifyResult>
inspectEndpointBeforeExecution(endpoint, options?): Promise<EndpointInspectionResult>
clearVerifyCache(): void
MemoryCache / defaultCache
// helpers: normalizeDomain, didWebId, wellKnownDidUrl, verifyDidJws, ...
```

## Development

Clone the repository, then install dependencies and run the local scripts:

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
