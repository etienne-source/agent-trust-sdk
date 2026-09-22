# Product Hunt launch copy

Draft for the AgenticTrust open-source launch. Trustflow Systems is the hosted registry named in the same post. No metrics are claimed because none are published with this draft.

## Name

AgenticTrust

## Headline

Open domain identity for AI agents, with Trustflow Systems as the hosted registry.

## Tagline

Signed did:web identity before an agent trusts a domain.

## Description

AI agents quote prices and call tools from domains they have never checked. AgenticTrust is the open protocol, SDK, CLI, and middleware for a W3C `did:web` document and a compact JWS on that document. Signatures are Ed25519 (`EdDSA`) or P-256 (`ES256`). `alg: none` and HMAC (`HS*`) proofs are rejected.

Trustflow Systems hosts the registry at trustflow.systems and api.trustflow.systems. The open code lives in the AgenticTrust monorepo. The registry is the hosted service. The badge reads: Verified by AgenticTrust | trustflow.systems.

What you can run from the repository today:

- `@agentic-trust/sdk` — verify a domain, or sign a `did:web` document
- `@agentic-trust/cli` — `npx agentic-trust init` once the npm scope exists; until then, the `agentic-trust` binary from a clone
- `@agentic-trust/mcp-server` — stdio tools for an audit, a key, and a signed `llms.txt`
- `@agentic-trust/next-plugin` — a development warning when `public/llms.txt` or `public/.well-known/did.json` is missing
- `@agentic-trust/langchain-middleware` and `@agentic-trust/vercel-ai-middleware` — refuse to parse unsigned `llms.txt`
- `starters/nextjs`, `starters/v0`, and `starters/bolt` — Next.js App Router boilerplates with a placeholder `did:web` and `llms.txt`

The packages are MIT licensed and installed from GitHub (`github:etienne-source/agent-trust-sdk`). They are not the unrelated npm package `trustflow-sdk`.

Site: https://trustflow.systems
Code: https://github.com/etienne-source/agent-trust-sdk

## First comment

Maker comment.

AgenticTrust is the open protocol. Trustflow Systems is the registry we run for it.

A domain publishes `https://<domain>/.well-known/did.json` (W3C `did:web`) and a plain `llms.txt`. The DID proof is a compact JWS. The SDK accepts `EdDSA` (Ed25519) and `ES256` (P-256) and rejects `alg: none` and `HS*`. Agents can call `verifyDomain` before they use a tool. LangChain and Vercel AI SDK middleware throw before they parse an unsigned `llms.txt`.

The CLI command is `npx agentic-trust init`. The `@agentic-trust` scope is not on npm yet, so today that binary comes from a clone of https://github.com/etienne-source/agent-trust-sdk (`pnpm --filter @agentic-trust/cli exec agentic-trust init`). The SDK alone installs with:

`pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk`

Please do not `npm install trustflow-sdk`. That name is a different package.

Registration talks to `https://api.trustflow.systems` (`POST /v1/register`, then `POST /v1/register/confirm`). The public page for a domain is `https://trustflow.systems/verify/<domain>`. The badge text is `Verified by AgenticTrust | trustflow.systems`.

The spec in the repo (`SPEC.md`) matches the SDK in `packages/sdk`. The registry’s domain-proof fetch is the private API’s `safeFetch` (HTTPS only, DNS public-IP checks, 4s timeout, at most one apex↔www same-path redirect). That function is not part of the open SDK.

Happy to answer how a `did:web` proof is checked, or how to point `verifyDomain` at `https://api.trustflow.systems`.
