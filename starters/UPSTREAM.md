# Contributing these starters upstream

`starters/nextjs`, `starters/v0`, and `starters/bolt` are ready to copy into popular Next.js, v0, and Bolt.new templates. Open those pull requests yourself, against a fork, one template at a time. This repository does not open them.

Do not send a drive-by pull request that replaces an existing app with the whole starter. Add the AgenticTrust files to the template that is already there.

## What to add

- `public/llms.txt`
- `public/.well-known/llms.txt` (same body as `public/llms.txt`)
- `public/.well-known/did.json` (the `REPLACE_ME` placeholder, or a signed document the maintainer generated)
- `.cursorrules`
- `.cursor/rules/agentic-trust.mdc`
- A `withAgenticTrust(...)` wrapper around the template's existing `next.config.js`, `next.config.mjs`, or `next.config.ts`
- This dependency, until the npm scope exists:

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/next-plugin
```

Leave `.agentic-trust/` and every private key out of the pull request. Do not document `npm install trustflow-sdk`.

In the template README, name **AgenticTrust** as the protocol and **Trustflow Systems** as the hosted registry, and point identity setup at `npx agentic-trust init` (from a clone of `github:etienne-source/agent-trust-sdk` until npm publish). After `init`, copy `.well-known/did.json` to `public/.well-known/did.json`, because Next.js serves `public/`.

## Suggested targets

Links below are the projects a human maintainer can fork. They are not pull requests, and this task does not open them.

### Next.js

| Target | What to propose |
|--------|-----------------|
| [vercel/next.js](https://github.com/vercel/next.js) `examples/` | A new `examples/with-agentic-trust` based on [`starters/nextjs`](./nextjs). Follow [contributing.md](https://github.com/vercel/next.js/blob/canary/contributing.md). |
| [vercel/commerce](https://github.com/vercel/commerce) | The identity files and a `withAgenticTrust` wrap of the existing Next config. Do not replace the storefront. |

### v0

v0 community templates are published in the product ([v0.app templates](https://v0.app/templates)), not only as GitHub pull requests.

| Target | What to propose |
|--------|-----------------|
| A template you exported from [v0.app](https://v0.app) or [v0.dev](https://v0.dev) | Drop in [`starters/v0`](./v0): `public/`, Cursor rules, and the `next.config.mjs` wrapper. Keep the export's Tailwind setup and `components/ui`. |
| [vercel/v0-starter-template](https://github.com/vercel/v0-starter-template) | Same identity patch on the create-next-app export. |
| [vercel/v0-sdk](https://github.com/vercel/v0-sdk) `examples/simple-v0` | Optional identity patch on the Platform API demo. That example is a different surface from a community UI template. |

### Bolt.new

[stackblitz/bolt.new](https://github.com/stackblitz/bolt.new) is the Bolt product (Remix). Do not open a pull request that adds this Next.js app to that repository.

| Target | What to propose |
|--------|-----------------|
| A Next.js project you created at [bolt.new](https://bolt.new) | Copy [`starters/bolt`](./bolt) (`next.config.js` CommonJS wrapper, `public/`, Cursor rules) into the project, then publish it as a template from Bolt if that flow is available. |
| [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | Reference only. Its templates are prompt starters inside the app. Do not add a full Next.js tree there. |

## Pull request checklist

- `pnpm dev` or `npm run dev` loads `withAgenticTrust`.
- `public/llms.txt` is non-empty and `public/.well-known/did.json` is JSON.
- Placeholders still say `REPLACE_ME`, or the maintainer replaced them with `npx agentic-trust init` and copied the signed DID into `public/`.
- The diff contains no `PRIVATE KEY` block and no `.agentic-trust/private-key.pem`.
- Install instructions use `github:etienne-source/agent-trust-sdk`, not `trustflow-sdk`.
