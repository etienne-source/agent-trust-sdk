# @trustflow/cli

Command-line scaffold for **Trustflow** domain identity and **Trustflow Systems** registration.

Binary: `trustflow`

**License:** MIT

> **Do not install `trustflow-sdk`.** That unscoped package is an unrelated logging package. The CLI command is `npx @trustflow/cli@latest init`. There is no unscoped `trustflow` package. After install, the command name is `trustflow`.

## Install

```bash
npx @trustflow/cli@latest init
```

`trustflow` is the binary from `@trustflow/cli`.

### Contributors

People changing this monorepo clone it and use pnpm. That is not the product install.

```bash
git clone https://github.com/etienne-source/agent-trust-sdk.git
cd agent-trust-sdk
pnpm install
pnpm --filter @trustflow/cli exec trustflow --help
```

## Configure

`TRUSTFLOW_API_URL` overrides the API base (default `https://api.trustflow.systems`). `trustflow sign` reads `AGENTIC_TRUST_PRIVATE_KEY`, `AGENTIC_TRUST_DOMAIN`, and `AGENTIC_TRUST_BUSINESS_NAME` from the environment when flags are omitted. See the repository `.env.example`.

## Run

```bash
trustflow init
trustflow confirm
trustflow sign --dry-run --domain example.invalid --name "Example Co"
```

## init

```bash
npx @trustflow/cli@latest init
```

1. Detects the framework and the directory served at the site origin. Next.js and Vite use `public/` (Vite `publicDir` is honored). Nuxt 3 uses `public/`; Nuxt 2 uses `static/`; `dir.public` / `dir.static` in `nuxt.config` wins. If the framework is unknown, an existing `public/` or `static/` folder is reused (`public/` wins when both exist). Otherwise the default is `public/`.
2. Searches for `llms.txt` at `llms.txt`, `.well-known/llms.txt`, `public/llms.txt`, `public/.well-known/llms.txt`, `static/llms.txt`, `static/.well-known/llms.txt`, `docs/llms.txt`, and `src/llms.txt`.
3. If none exist, prompts for site name, description, and optional services, then writes `llms.txt` and `.well-known/llms.txt` under that public directory. Next.js, Vite, Nuxt, and any project that already has `public/` or `static/` do not also get a workspace-root copy.
4. Generates an Ed25519 `did:web` key with `@trustflow/sdk` (`createSignedDidDocument`), writes `<public>/.well-known/did.json` only under that directory when it is a framework public folder, and stores `private-key.pem` in `.agentic-trust/` with mode `0600`. That directory is appended to `.gitignore`.
5. Registers the domain: `POST https://api.trustflow.systems/v1/register` with `domain`, `businessName`, `verificationType` (`SSL_CHALLENGE` by default, or `DNS_TXT`), and the SPKI `publicKeyPem`. Passing `--api-url https://trustflow.systems/api/register` uses the same API. The site path is not a separate server.
6. For `SSL_CHALLENGE`, writes `<public>/.well-known/agentic-trust-challenge.txt` (exact token, no trailing newline). Projects with `public/` do not also get a root copy. There is no manual token paste step.
7. Auto-confirms. The CLI polls `https://<domain>/.well-known/did.json` and the challenge URL in parallel (200ms interval, 8s budget). Confirm runs only after the live DID's `publicKeyPem` matches the registered key and the challenge body matches the token. `DNS_TXT` polls the TXT record instead of the challenge file. Then it `POST`s `https://api.trustflow.systems/v1/register/confirm` and prints the verify URL plus the badge. `--no-auto-confirm` (or `AGENTIC_TRUST_AUTO_CONFIRM=false`) skips that POST. `--skip-register` only writes local files.
8. Prints embeddable HTML/SVG: `Verified Domain Context | Trustflow`, linking to `https://trustflow.systems/verify/[domain]`.
9. When the project is Next.js and `middleware.ts` exists, updates the matcher so `/.well-known/` and `/llms.txt` are served as files.

API assumption: the live registry still issues a challenge token and, for SSL, expects `/.well-known/agentic-trust-challenge.txt`. A reachable `did.json` is not treated as a substitute for that file. The CLI does not confirm when it has not observed the live proof. If the proof window closes first, deploy the public directory and run `trustflow confirm`.

Non-interactive example:

```bash
npx @trustflow/cli@latest init \
  --non-interactive \
  --domain example.com \
  --name "Example Co" \
  --description "Widgets for agents" \
  --services "Search, Docs"
```

`--confirm` probes once and POSTs `/v1/register/confirm` during init. Confirm is not the default. `--skip-register` only writes local files.

## sign-llms

`npx @trustflow/cli@latest sign-llms` (`trustflow sign-llms`, `agentic-trust sign-llms`) signs an existing `llms.txt` by rewriting the JWS in the existing `did.json` only.

- Does not call `POST /v1/register`.
- Does not generate a challenge or write `agentic-trust-challenge.txt`.
- Does not rotate keys and does not rewrite `llms.txt`.
- Fails if `llms.txt`, `.agentic-trust/private-key.pem` (with `public-key.pem`), or `did.json` is missing.

## sign

`trustflow sign` is the non-interactive entry used by [`.github/actions/agentic-trust-sign`](../../.github/actions/agentic-trust-sign/action.yml).

1. If root `llms.txt` is missing, write the standard template (`renderLlms`) there and to `.well-known/llms.txt`.
2. Sign a `did:web` document with `@trustflow/sdk` (`createSignedDidDocument`) using `AGENTIC_TRUST_PRIVATE_KEY`.
3. `POST https://api.trustflow.systems/v1/register`, including the SPKI `publicKeyPem`.
4. Write `.well-known/agentic-trust-challenge.txt` and call `POST /v1/register/confirm` unless this is a dry run.

Set `AGENTIC_TRUST_PRIVATE_KEY` in the environment (do not pass it as an argument), then:

```bash
trustflow sign --domain example.com --name "Example Co"
```

`--dry-run` / `AGENTIC_TRUST_DRY_RUN=true` skips the register call. The private key is never printed. See the repository README for the GitHub Action inputs.

## Secrets

Do not commit `.agentic-trust/`. It contains the private key and the challenge token. `.well-known/did.json` and `llms.txt` are public and meant to be deployed.

## License

MIT
