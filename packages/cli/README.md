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

1. Detects the framework and the directory served at the site origin. Next.js and Vite use `public/` (Vite `publicDir` is honored). Nuxt 3 uses `public/`; Nuxt 2 uses `static/`; `dir.public` / `dir.static` in `nuxt.config` wins. If the framework is unknown, an existing `public/` or `static/` folder is reused (`public/` wins when both exist). Otherwise the default is `public/`.
2. Searches for `llms.txt` at `llms.txt`, `.well-known/llms.txt`, `public/llms.txt`, `public/.well-known/llms.txt`, `static/llms.txt`, `static/.well-known/llms.txt`, `docs/llms.txt`, and `src/llms.txt`.
3. If none exist, prompts for site name, description, and optional services, then writes `llms.txt` and `.well-known/llms.txt` under that public directory. The same bytes are mirrored at the repository root.
4. Generates an Ed25519 `did:web` key with `@agentic-trust/sdk` (`createSignedDidDocument`), writes `<public>/.well-known/did.json` (and the root mirror), and stores `private-key.pem` in `.agentic-trust/` with mode `0600`. That directory is appended to `.gitignore`.
5. Registers the domain: `POST https://api.trustflow.systems/v1/register` with `domain`, `businessName`, `verificationType` (`SSL_CHALLENGE` by default, or `DNS_TXT`), and the SPKI `publicKeyPem`. Passing `--api-url https://trustflow.systems/api/register` uses the same API. The site path is not a separate server.
6. For `SSL_CHALLENGE`, writes `<public>/.well-known/agentic-trust-challenge.txt` (exact token, no trailing newline) and the root mirror. There is no manual token paste step.
7. Auto-confirms. The CLI polls `https://<domain>/.well-known/did.json` and the challenge URL in parallel (200ms interval, 8s budget). Confirm runs only after the live DID's `publicKeyPem` matches the registered key and the challenge body matches the token. `DNS_TXT` polls the TXT record instead of the challenge file. Then it `POST`s `https://api.trustflow.systems/v1/register/confirm` and prints the verify URL plus the badge. `--no-auto-confirm` (or `AGENTIC_TRUST_AUTO_CONFIRM=false`) skips that POST. `--skip-register` only writes local files.
8. Prints embeddable HTML/SVG: `Verified by AgenticTrust | trustflow.systems`, linking to `https://trustflow.systems/verify/[domain]`.
9. Writes IDE rules at `.cursorrules` and `.cursor/rules/agentic-trust.mdc` for the detected public directory. Pass `--no-ide-rules` to skip both files.

API assumption: the live registry still issues a challenge token and, for SSL, expects `/.well-known/agentic-trust-challenge.txt`. A reachable `did.json` is not treated as a substitute for that file. The CLI does not confirm when it has not observed the live proof. If the proof window closes first, deploy the public directory and run `agentic-trust confirm`.

Non-interactive example:

```bash
npx agentic-trust init \
  --non-interactive \
  --domain example.com \
  --name "Example Co" \
  --description "Widgets for agents" \
  --services "Search, Docs"
```

`--confirm` forces the confirm POST. Auto-confirm is already the default. `--no-auto-confirm` registers without it. `--skip-register` only writes local files. `--no-ide-rules` skips `.cursorrules` and `.cursor/rules/agentic-trust.mdc` (written by default).

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
