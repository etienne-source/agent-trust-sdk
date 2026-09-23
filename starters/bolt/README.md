# AgenticTrust Bolt.new starter

Minimal [Next.js](https://nextjs.org) App Router app shaped for a [Bolt.new](https://bolt.new) template. `next.config.js` is CommonJS so Bolt's WebContainer can load `withAgenticTrust` through `require`. The app includes `app/page.tsx` and `GET /api/health`.

It ships a placeholder `did:web` identity, `llms.txt`, Cursor rules, and [`@trustflow/next-plugin`](../../packages/next-plugin/README.md).

**AgenticTrust** is the protocol, the SDK, the CLI, and this plugin (`did:web` signatures, `llms.txt`). **Trustflow Systems** is the hosted registry (`https://trustflow.systems`, API `https://api.trustflow.systems`). Say AgenticTrust when you mean the identity files or the plugin.

> Do not install `trustflow-sdk`. That npm package is unrelated. `@trustflow/next-plugin` is not on npm yet. This starter depends on `github:etienne-source/agent-trust-sdk#path:/packages/next-plugin`.

Bolt.new projects are created in the Bolt UI. Copy this folder's identity files, Cursor rules, and `next.config.js` wrapper into a Next.js project you opened there. Do not add a private key to the Bolt project.

## Run locally

Node.js 20 or newer. On your machine, or in a Bolt WebContainer:

```bash
pnpm install
pnpm dev
```

`npm install` and `npm run dev` work the same way. Open [http://localhost:3000](http://localhost:3000).

`next.config.js` wraps the Next config with `withAgenticTrust` and sets `turbopack: {}`. Next.js 16 uses Turbopack for `pnpm dev` and exits when a plugin adds a `webpack` hook without that key. The identity check still runs when the config loads. While `NODE_ENV` is `development`, the plugin checks:

| File | Valid when |
|------|------------|
| `public/llms.txt` | Exists, is readable, and is not empty. |
| `public/.well-known/did.json` | Exists, is readable, is not empty, and parses as JSON. |

If either file is missing or invalid, the terminal prints:

```text
[AgenticTrust Warning] Domain identity unverified. Run 'npx trustflow init' to generate did:web identity.
```

The warning does not stop `pnpm dev` or `pnpm build`. Production builds stay quiet. The committed placeholders pass that file check. They are not a signed identity.

```bash
pnpm build
pnpm start
```

## Vercel without a terminal

Signing does not require a local shell. Add `AGENTIC_TRUST_PRIVATE_KEY` (Sensitive) and `AGENTIC_TRUST_DOMAIN` in the Vercel project environment, install `@trustflow/vercel-plugin` from `github:etienne-source/agent-trust-sdk#path:/packages/vercel-plugin` (and the SDK path), and set:

```json
{
  "buildCommand": "agentic-trust-vercel && next build"
}
```

The build writes `public/llms.txt`, `public/.well-known/llms.txt`, and `public/.well-known/did.json`. The private key stays in Vercel and is not committed. Details are in [packages/vercel-plugin/README.md](../../packages/vercel-plugin/README.md). The local `npx trustflow init` flow below is the alternative when you do have a terminal.

## Replace the placeholders

`public/.well-known/did.json` is an unsigned example. `id`, `publicKeyPem`, and `proof.jws` are `REPLACE_ME`. No private key is in this folder. Do not commit `.agentic-trust/` or any PEM file. `.gitignore` already excludes them.

`public/llms.txt` and `public/.well-known/llms.txt` use the same body. The domain line is `REPLACE_ME.example`. Edit both copies so the hostname, site name, and services match the app, and keep the two files identical.

Then generate a real signature. The command you want, once `@trustflow/cli` is on npm:

```bash
npx trustflow init \
  --non-interactive \
  --domain your.domain \
  --name "Your site" \
  --description "What this site offers agents"
```

Until that scope is published, run the same `init` from a clone. The CLI depends on `@trustflow/sdk` with `workspace:*`, so install the repository rather than only the CLI folder:

```bash
git clone https://github.com/etienne-source/agent-trust-sdk.git
cd agent-trust-sdk
pnpm install
cd /path/to/this/starter
node /path/to/agent-trust-sdk/packages/cli/dist/cli.js init \
  --non-interactive \
  --domain your.domain \
  --name "Your site" \
  --description "What this site offers agents"
```

Inside this monorepo, from `starters/bolt`:

```bash
node ../../packages/cli/dist/cli.js init \
  --non-interactive \
  --domain your.domain \
  --name "Your site" \
  --description "What this site offers agents" \
  --skip-register
```

`--skip-register` writes the local files and skips `POST /v1/register`. Omit it when you want Trustflow Systems to issue a challenge.

`init` finds the existing `public/llms.txt` and leaves it in place. It writes the signed document to **`.well-known/did.json` at the project root**, and the private key to `.agentic-trust/private-key.pem` (mode `0600`, gitignored). Next.js serves `public/`, and the plugin reads `public/.well-known/did.json`, so copy the signed file:

```bash
cp .well-known/did.json public/.well-known/did.json
```

If `init` also wrote a root `llms.txt` or `.well-known/llms.txt`, copy those into `public/llms.txt` and `public/.well-known/llms.txt`. Publish `https://your.domain/llms.txt`, `https://your.domain/.well-known/llms.txt`, and `https://your.domain/.well-known/did.json`.

`init` refreshes `.cursorrules` and `.cursor/rules/agentic-trust.mdc`. Those rules already match the AgenticTrust `did:web` and signed `llms.txt` instructions for `public/`.

## Layout

```text
next.config.js                 withAgenticTrust via require (Bolt / WebContainer)
app/                           App Router page and GET /api/health
public/llms.txt
public/.well-known/llms.txt
public/.well-known/did.json    REPLACE_ME placeholder, not a private key
.cursorrules
.cursor/rules/agentic-trust.mdc
```
