# @agentic-trust/cli

Command-line scaffold for **AgenticTrust** domain identity and **Trustflow Systems** registration.

Binary: `agentic-trust`

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Warning:** Do not run `npm install trustflow-sdk`. That npm name is an unrelated logging package. Do not run `npx trustflow init`.

## Install

`@agentic-trust/cli` depends on `@agentic-trust/sdk` with `workspace:*`. Clone the repository so that link resolves. npm does not install a workspace package from a git URL, and `pnpm add github:...#path:/packages/cli` cannot resolve `workspace:*` on its own.

```bash
git clone https://github.com/etienne-source/agent-trust-sdk.git
cd agent-trust-sdk
pnpm install
pnpm --filter @agentic-trust/cli exec agentic-trust init
```

`dist/` is committed, so the binary runs after `pnpm install` links the SDK. Use `pnpm --filter @agentic-trust/cli exec agentic-trust --help` from the clone.

## init

```bash
npx agentic-trust init
```

1. Searches for `llms.txt` at `llms.txt`, `.well-known/llms.txt`, `public/llms.txt`, `public/.well-known/llms.txt`, `static/llms.txt`, `static/.well-known/llms.txt`, `docs/llms.txt`, and `src/llms.txt`.
2. If none exist, prompts for site name, description, and optional services, then writes `llms.txt` and `.well-known/llms.txt`.
3. Generates an RS256 `did:web` key with `@agentic-trust/sdk` (`createSignedDidDocument`), writes `.well-known/did.json`, and stores `private-key.pem` in `.agentic-trust/` with mode `0600`. That directory is appended to `.gitignore`.
4. Registers the domain: `POST https://api.trustflow.systems/v1/register` with `domain`, `businessName`, and `verificationType` (`SSL_CHALLENGE` by default, or `DNS_TXT`). Passing `--api-url https://trustflow.systems/api/register` uses the same API. The site path is not a separate server.
5. Writes `.well-known/agentic-trust-challenge.txt` for an SSL challenge (exact token, no trailing newline) and prints the API instructions.
6. Prints embeddable HTML/SVG: `Verified by AgenticTrust | trustflow.systems`, linking to `https://trustflow.systems/verify/[domain]`.

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

`--confirm` attempts confirmation in the same run. `--skip-register` only writes local files.

## Secrets

Do not commit `.agentic-trust/`. It contains the private key and the challenge token. `.well-known/did.json` and `llms.txt` are public and meant to be deployed.

## License

MIT
