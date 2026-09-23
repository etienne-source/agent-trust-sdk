# Trustflow starters

Drop-in Next.js App Router boilerplates for community templates. Each one includes a placeholder `did:web` document, `llms.txt`, Cursor rules, and `withAgenticTrust` from `@trustflow/next-plugin`.

| Folder | Intended upstream | Next config |
|--------|-------------------|-------------|
| [`nextjs`](./nextjs) | Next.js examples and App Router community templates | `next.config.ts` |
| [`v0`](./v0) | v0.dev / v0.app community templates | `next.config.mjs` |
| [`bolt`](./bolt) | Bolt.new Next.js templates | `next.config.js` |

These folders are not pnpm workspace packages. Scaffold identity with `npx @trustflow/cli@latest init` (`npx trustflow init` is an alias; `agentic-trust` is deprecated). From the folder you want, install its own dependencies and start Next.js:

```bash
pnpm install
pnpm dev
```

**Trustflow** is the protocol and the product (including this plugin). The registry is hosted at trustflow.systems. Do not install `trustflow-sdk`.

Copy a folder into an upstream template instead of pushing these files to `main` here or opening pull requests against third-party repositories from automation. [UPSTREAM.md](./UPSTREAM.md) is the note for that pull request.
