# @trustflow/vercel-plugin

Vercel and Next.js build hook for **AgenticTrust**. On deploy it writes `llms.txt` and a signed `.well-known/did.json` from environment variables. Nobody has to open a terminal or run `trustflow init`.

**AgenticTrust** is the protocol and this package. **Trustflow Systems** is the hosted registry (`https://trustflow.systems`).

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Do not install `trustflow-sdk`.** That name is an unrelated package. Install from GitHub: `github:etienne-source/agent-trust-sdk`.

The private key is `AGENTIC_TRUST_PRIVATE_KEY`. Put it in the Vercel project environment (Sensitive). This package never writes that PEM, never prints it, and never adds it to `vercel.json`.

## Install

`@trustflow/vercel-plugin` depends on `@trustflow/sdk` with `workspace:*` inside this repository. From another project, add both from GitHub:

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk github:etienne-source/agent-trust-sdk#path:/packages/vercel-plugin
```

## Vercel without a terminal

1. In the Vercel project, open **Settings → Environment Variables**. Add:
   - `AGENTIC_TRUST_PRIVATE_KEY` — unencrypted Ed25519 or P-256 PKCS#8 PEM. Mark it Sensitive.
   - `AGENTIC_TRUST_DOMAIN` — hostname, for example `shop.example`.
   - `AGENTIC_TRUST_BUSINESS_NAME` — optional. Falls back to the `#` heading in an existing `llms.txt`, then the domain.
   - `AGENTIC_TRUST_DESCRIPTION` and `AGENTIC_TRUST_SERVICES` — optional, used only when `llms.txt` is missing.
2. Do not put the PEM in the repository, in `vercel.json`, or in a committed `.env` file.
3. Set the build command so the hook runs before Next.js:

```json
{
  "buildCommand": "agentic-trust-vercel && next build"
}
```

`withAgenticTrustVercelConfig` returns that `buildCommand` for an existing config object. If `buildCommand` is already set, the helper prefixes `agentic-trust-vercel &&`.

4. Deploy with the Vercel dashboard or a git push. The build reads the secret from the environment, signs `did:web`, and writes:

| File | Served as |
|------|-----------|
| `public/llms.txt` | `https://<domain>/llms.txt` |
| `public/.well-known/llms.txt` | `https://<domain>/.well-known/llms.txt` |
| `public/.well-known/did.json` | `https://<domain>/.well-known/did.json` |

`public/` is chosen when that directory or a `next.config.*` file exists. Otherwise the same three files are written at the project root. An existing `llms.txt` is kept and its DID lines are aligned to the domain. The hook also adds `.agentic-trust/` and `*.pem` to `.gitignore` when they are missing. It does not create `.agentic-trust/`.

`VERCEL_PROJECT_PRODUCTION_URL` or `VERCEL_URL` is used only when `AGENTIC_TRUST_DOMAIN` is unset. There is no prompt.

`--dry-run` signs and prints `publicKeyHash` without writing files. It still requires the environment secret, and it still does not print the key.

Register the domain with Trustflow Systems separately (`POST https://api.trustflow.systems/v1/register`) when you want the hosted registry record. This hook only publishes the signed files.

The signer is `signBuildArtifacts` from `@trustflow/sdk`, the same function `renewBuildSignatures` uses for a Netlify build (`outDir` set to the publish directory). Neither function writes or prints the private key. The GitHub action `.github/actions/agentic-trust-sign` can commit the public `did.json` and `llms.txt` when its `commit` input is `true`.

## Programmatic

```ts
import { runAgenticTrustVercelBuild, withAgenticTrustVercelConfig } from "@trustflow/vercel-plugin";

export const vercelConfig = withAgenticTrustVercelConfig({
  framework: "nextjs",
});

await runAgenticTrustVercelBuild();
```

`@trustflow/next-plugin` remains the development warning when those public files are missing. This package is the build that creates them.
