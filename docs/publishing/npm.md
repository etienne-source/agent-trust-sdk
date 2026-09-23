# Publishing `@agentic-trust` packages

**AgenticTrust** is the protocol and the npm scope. **Trustflow Systems** is the hosted registry at https://trustflow.systems.

These workspace packages are version **1.0.0**, MIT licensed, and ready to publish. Their `repository` URL is `git+https://github.com/etienne-source/agent-trust-sdk.git`. Each has `"publishConfig": { "access": "public" }`.

| Package | Path |
|---------|------|
| `@agentic-trust/sdk` | `packages/sdk` |
| `@agentic-trust/cli` | `packages/cli` |
| `@agentic-trust/mcp-server` | `packages/mcp-server` |
| `@agentic-trust/next-plugin` | `packages/next-plugin` |
| `@agentic-trust/langchain-middleware` | `packages/langchain-middleware` |
| `@agentic-trust/vercel-ai-middleware` | `packages/vercel-ai-middleware` |
| `@agentic-trust/vercel-plugin` | `packages/vercel-plugin` |

The root `package.json` is `"private": true` and is not published. Starters under `starters/` are not workspace packages.

## Required GitHub secret

| Name | Where | Value |
|------|--------|--------|
| `NPM_TOKEN` | `etienne-source/agent-trust-sdk` → Settings → Secrets and variables → Actions | npm access token that can publish the `@agentic-trust` scope |

`.github/workflows/publish-npm.yml` reads `secrets.NPM_TOKEN` and passes it to the registry as `NODE_AUTH_TOKEN`. The token is not written into the workflow file and must not be committed.

Create the token on npm (Automation token, or a granular token limited to `@agentic-trust`). The first publish of a scoped package needs public access. `publishConfig.access` and `--access public` both set that.

## When the workflow runs

Push a tag that matches `v1.*` or `v*` (for example `v1.0.0`). The job installs with the frozen lockfile, runs tests, checks that the `@agentic-trust/sdk` edge bundle stays under 10KB, builds `dist/`, then publishes.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Pull requests do not publish. A tag push on a fork of this repository does not publish (`github.repository` must be `etienne-source/agent-trust-sdk`).

The publish command is:

```bash
pnpm --filter "@agentic-trust/*" --fail-if-no-match publish -r --access public --no-git-checks
```

`pnpm publish -r` walks the workspace in dependency order, so `@agentic-trust/sdk` is published before the packages that depend on it. `workspace:*` ranges are rewritten to the version in `package.json` inside the published tarball. `--no-git-checks` is required because a tag checkout is detached and is not the `main` branch.

## Install after the tag publish succeeds

```bash
pnpm add @agentic-trust/sdk
pnpm add @agentic-trust/cli
pnpm add @agentic-trust/mcp-server
pnpm add @agentic-trust/next-plugin
pnpm add @agentic-trust/langchain-middleware
pnpm add @agentic-trust/vercel-ai-middleware
pnpm add @agentic-trust/vercel-plugin
```

The CLI binary is `agentic-trust`. Until the tag workflow has succeeded, install from GitHub: `github:etienne-source/agent-trust-sdk`.

Do not install the unrelated package named `trustflow-sdk`. That name is not AgenticTrust.
