# AgenticTrust 0.1.0

First public release of the AgenticTrust monorepo. The feature list below is that open-source tree. Publishable packages are now version **1.0.0** in `package.json`. npm publication is [`.github/workflows/publish-npm.yml`](.github/workflows/publish-npm.yml) on `v1.*` and `v*` tags and needs the `NPM_TOKEN` secret ([docs/publishing/npm.md](docs/publishing/npm.md)). Merging the workflow does not publish. Until a tag publish succeeds, install from GitHub, `github:etienne-source/agent-trust-sdk`.

**AgenticTrust** is the protocol, SDK, CLI, MCP server, Next.js plugin, and framework middleware. **Trustflow Systems** is the hosted registry at https://trustflow.systems and https://api.trustflow.systems.

Do not install `trustflow-sdk`. That npm name is an unrelated package.

## Shipped

### `@trustflow/sdk` (`packages/sdk`)

- `did:web` documents via `createSignedDidDocument` (Ed25519 by default, or a supplied P-256 key).
- Compact JWS proofs (`proof.type` `JsonWebSignature2020`) pinned to `EdDSA` and `ES256`. `alg: none`, `HS*`, and every other `alg` fail closed.
- `verifyDomain` reads `https://<domain>/.well-known/did.json` and can fall back to `GET /v1/verify?domain=`.
- `inspectEndpointBeforeExecution` requires HTTPS.
- `agenticTrustMiddleware` annotates context and `fetch` (4s budget, in-memory cache). It does not throw on an unverified domain.
- `hashPublicKeyPem` is the SHA-256 hex the registry stores as `publicKeyHash`.

### `@trustflow/cli` (`packages/cli`)

Binary: `trustflow`.

- `init` — write `llms.txt` when it is missing, sign `.well-known/did.json`, store the private key under `.agentic-trust/` (mode `0600`, gitignored), `POST /v1/register`, print the challenge, print the badge, and write IDE rules.
- `confirm` — `POST /v1/register/confirm`.
- `sign` — non-interactive path used by the GitHub Action. `--dry-run` skips the API call.
- Badge label: `Verified by AgenticTrust | trustflow.systems`. Link: `https://trustflow.systems/verify/<domain>`.
- Default API base: `https://api.trustflow.systems`. `https://trustflow.systems/api/register` is an alias of that origin.

The intended npm command, after the scope exists, is `npx trustflow init`. Until then, run the binary from a clone.

### `@trustflow/mcp-server` (`packages/mcp-server`)

Stdio MCP server, binary `agentic-trust-mcp`.

- `audit_domain` — `GET /v1/verify?domain=`
- `generate_did_keys` — Ed25519 or ES256, signed with the SDK
- `sign_llms_txt` — align an `llms.txt` manifest with that `did:web` document

### `@trustflow/next-plugin` (`packages/next-plugin`)

`withAgenticTrust` warns in `next dev` when `public/llms.txt` or `public/.well-known/did.json` is missing or invalid. The warning does not fail the build. Production builds stay quiet.

### Framework middleware

- `@trustflow/langchain-middleware` — throws `UnverifiedDomainContextError` before unsigned `llms.txt` is parsed.
- `@trustflow/vercel-ai-middleware` — same refusal on provider `fetch` and `wrapLanguageModel` for domain-context payloads.

Both call `@trustflow/sdk`. The SDK middleware still annotates; these two packages are the strict gate.

### Starters (`starters/`)

App Router boilerplates that are not pnpm workspace packages: [starters/nextjs](starters/nextjs), [starters/v0](starters/v0), and [starters/bolt](starters/bolt). Each wraps `next.config` with `withAgenticTrust` and commits placeholder `public/llms.txt` and `public/.well-known/did.json` files (`REPLACE_ME`, no private key). `pnpm starters:check` validates them. Upstream copy notes are in [starters/UPSTREAM.md](starters/UPSTREAM.md).

### GitHub Action

`.github/actions/agentic-trust-sign` checks out a repo, ensures `llms.txt`, signs with `createSignedDidDocument`, and can `POST /v1/register` plus confirm. The private key is an environment secret and is not printed. `.github/workflows/ci.yml` runs test, typecheck, and build.

### Docs in this release

- `SPEC.md` — `did:web`, JWS pinning, and the split between the SDK fetch and the registry’s `safeFetch`.
- `README.md` — architecture, GitHub install, and the verify-page badge link.

## Registry contract this release speaks

| Method | URL |
|--------|-----|
| `POST` | `https://api.trustflow.systems/v1/register` |
| `POST` | `https://api.trustflow.systems/v1/register/confirm` |
| `GET` | `https://api.trustflow.systems/v1/verify?domain=` |

`verificationType` is `SSL_CHALLENGE` or `DNS_TXT`. For SSL, the CLI writes `.well-known/agentic-trust-challenge.txt` with the challenge token as the body. For DNS, it prints the `dnsRecord` the API returns.

## Not in 0.1.0

- npm packages under `@trustflow/*`.
- A hosted badge image URL. The CLI prints inline SVG. The public page is `https://trustflow.systems/verify/<domain>`.
- The registry implementation, including `safeFetch`. That fetcher is private. The open SDK does not export it. `SPEC.md` records its SSRF limits by reference: HTTPS only, DNS public-IP checks, a 4 second timeout, and at most one apex↔www redirect on the same path.

## Verify the tree

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Node.js 20 or newer. License: MIT.
