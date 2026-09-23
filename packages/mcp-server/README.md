# @trustflow/mcp-server

Stdio [Model Context Protocol](https://modelcontextprotocol.io) server for **Trustflow** domain identity. Cursor, Windsurf, and Claude Desktop can call it as a local MCP server.

**Trustflow** is the protocol and the SDK (`@trustflow/sdk`). **Trustflow Systems** is the hosted registry (`https://api.trustflow.systems`).

| Tool | What it does |
|------|----------------|
| `audit_domain` | `GET /v1/verify?domain=` — status, `isVerified`, TrustScore, and audit factors |
| `generate_did_keys` | Ed25519 (default) or ES256 (P-256) key pair and a signed W3C `did:web` document |
| `sign_llms_txt` | Sign an `llms.txt` manifest with the domain private key |

Signing uses `@trustflow/sdk` `createSignedDidDocument` (EdDSA or ES256 compact JWS). This package does not invent a second proof format.

**License:** MIT

> **Do not install `trustflow-sdk`.** That name is an unrelated logging package. Scaffold a domain with `npx @trustflow/cli@latest init`.

## Install

```bash
npx @trustflow/cli@latest init
npx -y @trustflow/mcp-server
```

`npx trustflow init` is an alias of the CLI. Binary: `agentic-trust-mcp`.

### Contributors

Clone and `pnpm install` apply only when changing this monorepo. They are not the product install.

```bash
git clone https://github.com/etienne-source/agent-trust-sdk.git
cd agent-trust-sdk
pnpm install
pnpm --filter @trustflow/mcp-server build
```

## MCP client config

Same shape for Cursor and Claude Desktop. The server speaks MCP over stdio.

### Cursor (`cursor.json` or `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "agentic-trust": {
      "command": "node",
      "args": ["/absolute/path/to/agent-trust-sdk/packages/mcp-server/dist/index.js"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "agentic-trust": {
      "command": "node",
      "args": ["/absolute/path/to/agent-trust-sdk/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Contributors in this monorepo can also run `pnpm --filter @trustflow/mcp-server exec agentic-trust-mcp`.

Published server:

```json
{
  "mcpServers": {
    "agentic-trust": {
      "command": "npx",
      "args": ["-y", "@trustflow/mcp-server"]
    }
  }
}
```

## Tools

### `audit_domain`

Fetches `GET {base}/v1/verify?domain=`. Default base: `https://api.trustflow.systems`. Pass `baseUrl` to point at another origin (unit tests do this; they do not call the network).

Returns structured content:

- `status` — registry status (`VERIFIED`, `UNVERIFIED`, or `RISK`)
- `isVerified` — `true` when the registry says so, or when `status` is `VERIFIED`
- `audit.score` — TrustScore (`audit.score`, or a top-level `trustScore` when that is all the payload has)
- `audit.factors` — score factors from the Trustflow Domain Audit

### `generate_did_keys`

Arguments: `domain`, optional `algorithm` (`Ed25519` default, or `ES256` / `P-256`), optional `privateKeyPath`.

Ed25519 generation and the JWS proof both go through `createSignedDidDocument`. ES256 generates a P-256 PKCS#8 key and passes it into that same SDK function.

The result includes `didJson` (public, suitable for `.well-known/did.json`) and `privateKeyPem`. `secret.label` is `SECRET`. The private key is not written unless `privateKeyPath` is set (mode `0600`).

### `sign_llms_txt`

Arguments: `domain`, `privateKeyPem`, and `llmsTxt` or `llmsTxtPath`. Optional `outputDir`.

The SDK signs a `did:web` document whose `LinkedDomains` service endpoint is `https://<domain>/.well-known/llms.txt`. That document is the Trustflow signature for the manifest, matching `@trustflow/cli`. The returned `llms.txt` keeps the caller's prose and names the same `did:web`.

`outputDir` writes only public files: `llms.txt`, `.well-known/llms.txt`, and `.well-known/did.json`. The private key is never written.

Publish those files, then register with Trustflow Systems (`POST https://api.trustflow.systems/v1/register`) via `trustflow init` or `trustflow sign`.
