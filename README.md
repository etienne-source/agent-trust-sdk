# @trustflow/sdk

Lightweight TypeScript client for **Trustflow** domain identity verification.
Use it in AI agents and frameworks before tool / MCP execution to reduce tool
poisoning, fake listings, and unverified data.

**License:** MIT · **Package:** `@trustflow/sdk` · **Install:** GitHub only

> **Warning:** Do not install `trustflow-sdk` from the public npm registry — that is a different package (unrelated logging).

## Install

The `@trustflow` npm scope is not registered yet. This repository's `package.json` name is `@trustflow/sdk`, and the only supported install is from Git. That GitHub URL installs the package so imports resolve to `@trustflow/sdk`:

```bash
pnpm add github:etienne-source/agent-trust-sdk
# or: npm install github:etienne-source/agent-trust-sdk
# or: yarn add github:etienne-source/agent-trust-sdk
```

## Migration

Function names are unchanged. Install from Git and import `@trustflow/sdk`.

| Before | After |
|--------|--------|
| `agent-trust-sdk` | `@trustflow/sdk` via `github:etienne-source/agent-trust-sdk` |
| `import { verifyDomain } from "agent-trust-sdk"` | `import { verifyDomain } from "@trustflow/sdk"` |

## CLI

This package is the verification SDK and does not ship a CLI. A future Trustflow CLI command is:

```bash
npx trustflow init
```

Install this SDK with the GitHub commands in [Install](#install).

## Quick start

```ts
import {
  verifyDomain,
  inspectEndpointBeforeExecution,
  clearVerifyCache,
} from "@trustflow/sdk";

// 1) Verify a business domain (did:web + JWS, with optional API fallback)
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

| Framework / pattern | Integration tip |
|---------------------|-----------------|
| **LangChain / LangGraph** | Wrap tool registration: call `inspectEndpointBeforeExecution` on each tool URL before binding. |
| **OpenAI Agents / function calling** | Before `fetch`/`tools` invocation, `verifyDomain` on the host of any remote tool schema URL. |
| **MCP clients** | On `tools/list` or connect, inspect each `serviceEndpoint`; refuse non-HTTPS or RISK. |
| **Custom agent loops** | Cache-first `verifyDomain` on first contact with a domain; reuse until TTL expires. |

Statuses:

- **VERIFIED** — `did:web` present and JWS verifies (and/or central registry confirms)
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
