# AgenticTrust

Open-standard domain identity for AI agents, plus the Trustflow Systems registry client.

| Piece | Name | What it is |
|-------|------|------------|
| Protocol, SDK, CLI | **AgenticTrust** | `did:web` signatures, `@agentic-trust/sdk`, `@agentic-trust/cli` |
| Hosted platform | **Trustflow Systems** | [trustflow.systems](https://trustflow.systems) · API `https://api.trustflow.systems` |

`@agentic-trust/sdk` verifies domain identity with DID signatures (`did:web` + JWS) before tool / MCP execution. `@agentic-trust/cli` scaffolds a domain and registers it with Trustflow Systems.

**License:** MIT

> **Warning:** Do not run `npm install trustflow-sdk`. That npm name is an unrelated logging package. Do not run `npx trustflow init`.

The `@agentic-trust` npm scope is not registered yet. Install from this Git repository.

## CLI

`@agentic-trust/cli` depends on `@agentic-trust/sdk` via `workspace:*`. Clone the repository so that dependency resolves:

```bash
git clone https://github.com/etienne-source/agent-trust-sdk.git
cd agent-trust-sdk
pnpm install
pnpm --filter @agentic-trust/cli exec agentic-trust init
```

`dist/` is already built in the repository, so you do not need a compile step to run the binary. Do not `pnpm add` only `packages/cli` from Git: pnpm cannot satisfy `workspace:*` outside this repository.

`agentic-trust init`:

1. Looks for `llms.txt` (project root, `.well-known/`, `public/`, `static/`, `docs/`, `src/`). If it is missing, prompts for site name, description, and optional services, then writes `llms.txt` and `.well-known/llms.txt`.
2. Generates an RS256 `did:web` key, signs `.well-known/did.json`, and stores the private key in `.agentic-trust/` (added to `.gitignore`, mode `0600`).
3. Registers the domain with Trustflow: `POST https://api.trustflow.systems/v1/register` (`verificationType` `SSL_CHALLENGE` or `DNS_TXT`). `https://trustflow.systems/api/register` is an alias of that API origin.
4. Prints the challenge instructions. `agentic-trust confirm` calls `POST /v1/register/confirm`.
5. Prints an embeddable badge: **Verified by AgenticTrust | trustflow.systems**, linking to `https://trustflow.systems/verify/[domain]`.

## SDK

`@agentic-trust/sdk` verifies a domain before an agent calls a tool.

```bash
# From a clone of this repository the SDK is packages/sdk (@agentic-trust/sdk).
# Once this layout is the default branch, this also works:
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk
```

```ts
import {
  verifyDomain,
  inspectEndpointBeforeExecution,
  clearVerifyCache,
} from "@agentic-trust/sdk";

// AgenticTrust did:web DID signature + JWS, with optional API fallback
const result = await verifyDomain("example.com");
// result.status: "VERIFIED" | "UNVERIFIED" | "RISK"

if (result.status !== "VERIFIED") {
  throw new Error(result.reason ?? result.status);
}

const gate = await inspectEndpointBeforeExecution("https://example.com/mcp");
if (!gate.allowed) throw new Error(gate.reason ?? "Endpoint blocked");
```

Set `VERIFICATION_API_URL=https://api.trustflow.systems` to use the hosted registry (`GET /v1/verify?domain=`). See `.env.example`.

### Migration

Function names are unchanged. Install from Git and import `@agentic-trust/sdk`.

| Previous | Current |
|----------|---------|
| `agent-trust-sdk` | `@agentic-trust/sdk` |
| `@trustflow/sdk` | `@agentic-trust/sdk` |
| `import { verifyDomain } from "agent-trust-sdk"` | `import { verifyDomain } from "@agentic-trust/sdk"` |
| `import { verifyDomain } from "@trustflow/sdk"` | `import { verifyDomain } from "@agentic-trust/sdk"` |
| `npx trustflow init` | `npx agentic-trust init` |

### How AI frameworks should use it

| Framework / pattern | Integration tip |
|---------------------|-----------------|
| **LangChain / LangGraph** | Wrap tool registration: call `inspectEndpointBeforeExecution` on each tool URL before binding. |
| **OpenAI Agents / function calling** | Before `fetch`/`tools` invocation, `verifyDomain` on the host of any remote tool schema URL. |
| **MCP clients** | On `tools/list` or connect, inspect each `serviceEndpoint`; refuse non-HTTPS or RISK. |
| **Custom agent loops** | Cache-first `verifyDomain` on first contact with a domain; reuse until TTL expires. |

Statuses:

- **VERIFIED** — AgenticTrust `did:web` present and the DID signature (JWS) verifies (and/or the Trustflow registry confirms)
- **UNVERIFIED** — missing manifest, key, proof, or registry entry
- **RISK** — bad signature, non-`did:web`, or unsafe endpoint (for example non-HTTPS)

## Trustflow register API

Live contract (not a guessed path):

| Method | URL |
|--------|-----|
| `GET` | `https://api.trustflow.systems/health` |
| `POST` | `https://api.trustflow.systems/v1/register` |
| `POST` | `https://api.trustflow.systems/v1/register/confirm` |
| `GET` | `https://api.trustflow.systems/v1/verify?domain=` |

`POST /v1/register` requires `domain`, `businessName`, and `verificationType` (`SSL_CHALLENGE` or `DNS_TXT`). The response includes `challengeToken`, `instructions`, and either `challengePath` (HTTPS file `/.well-known/agentic-trust-challenge.txt`) or `dnsRecord` (`_agentic-trust.<domain>` TXT `agentic-trust-verification=<token>`). Confirm with `domain` and `challengeToken`.

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm smoke
```

`packages/*/dist` is committed so a clone can run `agentic-trust` before the npm scope exists. Rebuild and commit `dist/` when CLI or SDK sources change.

`TRUSTFLOW_LIVE=1 pnpm --filter @agentic-trust/cli test` also calls the production register endpoint.

## License

MIT
