# Publishing `@trustflow` packages

**Trustflow** is the open protocol. These packages publish under the npm scope `@trustflow` because `@agentic-trust` is registered to an unrelated maintainer. **Trustflow Systems** is the hosted registry at https://trustflow.systems.

These workspace packages share one version, MIT licensed, and ready to publish. Their `repository` URL is `git+https://github.com/etienne-source/agent-trust-sdk.git`. Each has `"publishConfig": { "access": "public" }`.

| Package | Path |
|---------|------|
| `@trustflow/sdk` | `packages/sdk` |
| `@trustflow/cli` | `packages/cli` |
| `@trustflow/mcp-server` | `packages/mcp-server` |
| `@trustflow/next-plugin` | `packages/next-plugin` |
| `@trustflow/vercel-plugin` | `packages/vercel-plugin` |

The root `package.json` is `"private": true` and is not published.

## Required GitHub secret

| Name | Where | Value |
|------|--------|--------|
| `NPM_TOKEN` | `etienne-source/agent-trust-sdk` → Settings → Secrets and variables → Actions | npm access token that can publish the `@trustflow` scope |

`.github/workflows/publish-npm.yml` reads `secrets.NPM_TOKEN` and passes it to the registry as `NODE_AUTH_TOKEN`. The token is not written into the workflow file and must not be committed.

Create the token on npm (Automation token, or a granular token limited to `@trustflow`). The first publish of a scoped package needs public access. `publishConfig.access` and `--access public` both set that.

## When the workflow runs

Push a tag that matches `v1.*` or `v*` (for example `v1.0.6`). The job installs with the frozen lockfile, checks that the `@trustflow/sdk` edge bundle stays under 10KB, builds `dist/`, then publishes. Tests run in CI on the commit before the tag.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Pull requests do not publish. A tag push on a fork of this repository does not publish (`github.repository` must be `etienne-source/agent-trust-sdk`).

The publish command is:

```bash
pnpm --filter "@trustflow/*" --fail-if-no-match publish -r --access public --no-git-checks
```

`pnpm publish -r` walks the workspace in dependency order, so `@trustflow/sdk` is published before the packages that depend on it. `workspace:*` ranges are rewritten to the version in `package.json` inside the published tarball. `--no-git-checks` is required because a tag checkout is detached and is not the `main` branch.

## Install after the tag publish succeeds

```bash
pnpm add @trustflow/sdk
pnpm add @trustflow/cli
pnpm add @trustflow/mcp-server
pnpm add @trustflow/next-plugin
pnpm add @trustflow/vercel-plugin
```

The CLI binary is `trustflow`. Until the tag workflow has succeeded, install from GitHub: `github:etienne-source/agent-trust-sdk`.

Do not install the unrelated package named `trustflow-sdk`. That name is not Trustflow.
