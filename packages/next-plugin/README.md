# @agentic-trust/next-plugin

Next.js config wrapper for **AgenticTrust** domain identity.

In development (`NODE_ENV=development`) it checks:

| File | Valid when |
|------|------------|
| `public/llms.txt` | The file exists, is readable, and is not empty. |
| `public/.well-known/did.json` | The file exists, is readable, is not empty, and parses as JSON. |

If either file is missing or invalid, the plugin prints:

```text
[AgenticTrust Warning] Domain identity unverified. Run 'npx agentic-trust init' to generate did:web identity.
```

The warning does not fail `next dev` or `next build`. Production builds (`NODE_ENV` other than `development`) stay quiet.

**AgenticTrust** is the protocol and this plugin. **Trustflow Systems** is the hosted registry that `npx agentic-trust init` registers with. This package does not call the registry.

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Do not install `trustflow-sdk`.** `npm install trustflow-sdk` and `npx trustflow init` point at an unrelated logging package. Install this plugin from GitHub: `github:etienne-source/agent-trust-sdk`.

## Install

`@agentic-trust/next-plugin` has no workspace dependencies, so a GitHub path install works:

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/next-plugin
```

From a clone of this repository it is the workspace package `@agentic-trust/next-plugin`. Next.js 13 or newer is the host app. This package does not bundle Next.js.

Scaffold the identity files with the AgenticTrust CLI (`@agentic-trust/cli`):

```bash
npx agentic-trust init
```

Publish `public/llms.txt` and `public/.well-known/did.json` with the Next.js app. `public/` is served from the site root, which is where clients fetch `/.well-known/did.json`.

## Usage

`withAgenticTrust` returns the config you pass in (spread) and attaches the development check. An existing `webpack` function is still called.

### CommonJS (`next.config.js`)

```js
const { withAgenticTrust } = require("@agentic-trust/next-plugin");

module.exports = withAgenticTrust({
  reactStrictMode: true,
});
```

### ESM (`next.config.mjs`)

```js
import { withAgenticTrust } from "@agentic-trust/next-plugin";

export default withAgenticTrust({
  reactStrictMode: true,
});
```

### TypeScript (`next.config.ts`)

```ts
import type { NextConfig } from "next";
import { withAgenticTrust } from "@agentic-trust/next-plugin";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withAgenticTrust(nextConfig);
```

Pass `cwd` when the Next.js app is not `process.cwd()`:

```js
const path = require("node:path");
const { withAgenticTrust } = require("@agentic-trust/next-plugin");

module.exports = withAgenticTrust(
  { reactStrictMode: true },
  { cwd: path.join(__dirname) }
);
```

Function configs are wrapped the same way. The check runs when Next.js calls the function, and again from the `webpack` hook for the project directory Next passes in `dir`. The warning is printed once per directory.
