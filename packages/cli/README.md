# @agentic-trust/cli

Command-line scaffold for **AgenticTrust** domain identity and **Trustflow Systems** registration.

Binary: `agentic-trust`

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Do not install `trustflow-sdk`.** `npm install trustflow-sdk` and `npx trustflow init` point at an unrelated logging package. Install from GitHub: `github:etienne-source/agent-trust-sdk`.

## Install

`@agentic-trust/cli` depends on `@agentic-trust/sdk` with `workspace:*`. Clone `github:etienne-source/agent-trust-sdk` so that link resolves. npm does not install a workspace package from a git URL, and `pnpm add github:etienne-source/agent-trust-sdk#path:/packages/cli` cannot resolve `workspace:*` on its own.

```bash
git clone https://github.com/etienne-source/agent-trust-sdk.git
cd agent-trust-sdk
pnpm install
pnpm --filter @agentic-trust/cli exec agentic-trust init
```

`dist/` is committed, so the binary runs after `pnpm install` links the SDK. Use `pnpm --filter @agentic-trust/cli exec agentic-trust --help` from the clone.

## Configure

`TRUSTFLOW_API_URL` overrides the API base (default `https://api.trustflow.systems`). `agentic-trust sign` reads `AGENTIC_TRUST_PRIVATE_KEY`, `AGENTIC_TRUST_DOMAIN`, and `AGENTIC_TRUST_BUSINESS_NAME` from the environment when flags are omitted. See the repository `.env.example`.

## Run

```bash
agentic-trust init
agentic-trust confirm
agentic-trust sign --dry-run --domain example.invalid --name "Example Co"
```

## init

```bash
npx agentic-trust init
```

1. Searches for `llms.txt` at `llms.txt`, `.well-known/llms.txt`, `public/llms.txt`, `public/.well-known/llms.txt`, `static/llms.txt`, `static/.well-known/llms.txt`, `docs/llms.txt`, and `src/llms.txt`.
2. If none exist, prompts for site name, description, and optional services, then writes `llms.txt` and `.well-known/llms.txt`.
3. Generates an Ed25519 `did:web` key with `@agentic-trust/sdk` (`createSignedDidDocument`), writes `.well-known/did.json`, and stores `private-key.pem` in `.agentic-trust/` with mode `0600`. That directory is appended to `.gitignore`.
4. Registers the domain: `POST https://api.trustflow.systems/v1/register` with `domain`, `businessName`, and `verificationType` (`SSL_CHALLENGE` by default, or `DNS_TXT`). Passing `--api-url https://trustflow.systems/api/register` uses the same API. The site path is not a separate server.
5. Writes `.well-known/agentic-trust-challenge.txt` for an SSL challenge (exact token, no trailing newline) and prints the API instructions.
6. Prints embeddable HTML/SVG: `Verified by AgenticTrust | trustflow.systems`, linking to `https://trustflow.systems/verify/[domain]`.
7. Writes IDE rules at `.cursorrules` and `.cursor/rules/agentic-trust.mdc`. They tell coding agents to publish a W3C `did:web` document at `public/.well-known/did.json` (or `static/` when that folder already exists) and to keep a signed `public/llms.txt` via `@agentic-trust/sdk` (`createSignedDidDocument`). Pass `--no-ide-rules` to skip both files.

After the challenge file or DNS TXT is live:

```bash
npx agentic-trust confirm
```

That is `POST https://api.trustflow.systems/v1/register/confirm` with the saved `domain` and `challengeToken`.

Non-interactive example:

```bash
npx agentic-trust init \
  --non-interactive \
  --domain example.com \
  --name "Example Co" \
  --description "Widgets for agents" \
  --services "Search, Docs"
```

`--confirm` attempts confirmation in the same run. `--skip-register` only writes local files. `--no-ide-rules` skips `.cursorrules` and `.cursor/rules/agentic-trust.mdc` (written by default).

## sign

`agentic-trust sign` is the non-interactive entry used by [`.github/actions/agentic-trust-sign`](../../.github/actions/agentic-trust-sign/action.yml).

1. If root `llms.txt` is missing, write the standard template (`renderLlms`) there and to `.well-known/llms.txt`.
2. Sign a `did:web` document with `@agentic-trust/sdk` (`createSignedDidDocument`) using `AGENTIC_TRUST_PRIVATE_KEY`.
3. `POST https://api.trustflow.systems/v1/register`, including the SPKI `publicKeyPem`.
4. Write `.well-known/agentic-trust-challenge.txt` and call `POST /v1/register/confirm` unless this is a dry run.

Set `AGENTIC_TRUST_PRIVATE_KEY` in the environment (do not pass it as an argument), then:

```bash
agentic-trust sign --domain example.com --name "Example Co"
```

`--dry-run` / `AGENTIC_TRUST_DRY_RUN=true` skips the register call. The private key is never printed. See the repository README for the GitHub Action inputs.

## Secrets

Do not commit `.agentic-trust/`. It contains the private key and the challenge token. `.well-known/did.json` and `llms.txt` are public and meant to be deployed.

## License

MIT
