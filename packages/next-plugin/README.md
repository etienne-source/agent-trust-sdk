# @trustflow/next-plugin

Next.js config wrapper for **Trustflow** domain identity.

In development (`NODE_ENV=development`) it checks:

| File | Valid when |
|------|------------|
| `public/llms.txt` | The file exists, is readable, and is not empty. |
| `public/.well-known/did.json` | The file exists, is readable, is not empty, and parses as JSON. |

If either file is missing or invalid, the plugin prints:

```text
[Trustflow Warning] Domain identity unverified. Run 'npx @trustflow/cli@latest init' to generate did:web identity.
```

The warning does not fail `next dev` or `next build`. Production builds (`NODE_ENV` other than `development`) stay quiet.

**Trustflow** is the protocol and this plugin. **Trustflow Systems** is the hosted registry that `npx trustflow init` registers with. This package does not call the registry.

**License:** MIT

> **Do not install `trustflow-sdk`.** That unscoped package is an unrelated logging package. Scaffold identity with `npx @trustflow/cli@latest init`.

## Install

```bash
npx @trustflow/cli@latest init
npm install @trustflow/next-plugin
```

`npx trustflow init` is an alias of `@trustflow/cli`. Next.js 13 or newer is the host app. This package does not bundle Next.js.

### Contributors

Clone and `pnpm install` apply only when changing this monorepo. They are not the product install.

## Sign on Vercel without a terminal

A Next.js app on Vercel can publish the identity files during the build. Install `@trustflow/vercel-plugin` and `@trustflow/sdk` (`npm install @trustflow/vercel-plugin @trustflow/sdk`). In the Vercel project environment set `AGENTIC_TRUST_PRIVATE_KEY` (Sensitive) and `AGENTIC_TRUST_DOMAIN`. Set `vercel.json`:

```json
{
  "buildCommand": "agentic-trust-vercel && next build"
}
```

Deploy from the Vercel dashboard or a git push. The hook writes `public/llms.txt` and `public/.well-known/did.json`. It does not prompt, and it does not commit the private key. That is the path that does not need a terminal.

The Trustflow CLI (`npx @trustflow/cli@latest init`) is the local alternative. This plugin only warns in development; it does not sign.

Publish `public/llms.txt` and `public/.well-known/did.json` with the Next.js app. `public/` is served from the site root, which is where clients fetch `/.well-known/did.json`.

## Usage

`withAgenticTrust` returns the config you pass in (spread) and attaches the development check. An existing `webpack` function is still called.

### CommonJS (`next.config.js`)

```js
const { withAgenticTrust } = require("@trustflow/next-plugin");

module.exports = withAgenticTrust({
  reactStrictMode: true,
});
```

### ESM (`next.config.mjs`)

```js
import { withAgenticTrust } from "@trustflow/next-plugin";

export default withAgenticTrust({
  reactStrictMode: true,
});
```

### TypeScript (`next.config.ts`)

```ts
import type { NextConfig } from "next";
import { withAgenticTrust } from "@trustflow/next-plugin";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withAgenticTrust(nextConfig);
```

Pass `cwd` when the Next.js app is not `process.cwd()`:

```js
const path = require("node:path");
const { withAgenticTrust } = require("@trustflow/next-plugin");

module.exports = withAgenticTrust(
  { reactStrictMode: true },
  { cwd: path.join(__dirname) }
);
```

Function configs are wrapped the same way. The check runs when Next.js calls the function, and again from the `webpack` hook for the project directory Next passes in `dir`. The warning is printed once per directory.
