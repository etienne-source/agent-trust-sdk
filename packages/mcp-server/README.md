# @trustflow/mcp-server

Stdio [Model Context Protocol](https://modelcontextprotocol.io) server for **Trustflow** domain identity. Cursor, Windsurf, and Claude Desktop can call it as a local MCP server.

**Trustflow** is the protocol and the SDK (`@trustflow/sdk`). **Trustflow Systems** is the hosted registry (`https://api.trustflow.systems`).

| Tool | What it does |
|------|----------------|
| `audit_domain` | `GET /v1/verify?domain=` — status, `isVerified`, TrustScore, and audit factors |
| `generate_did_keys` | Ed25519 (default) or ES256 (P-256) key pair and a signed W3C `did:web` document. The private key is written to `privateKeyPath` and is not returned. |
| `sign_llms_txt` | Sign an `llms.txt` manifest with the domain private key read from `privateKeyPath` |

Signing uses `@trustflow/sdk` `createSignedDidDocument` (EdDSA or ES256 compact JWS). This package does not invent a second proof format. Paths a tool reads or writes must be inside the server root (`AGENTIC_TRUST_MCP_ROOT`, or the process working directory). The registry base is a server option (`TRUSTFLOW_API_URL`), not a tool argument.

**License:** MIT

> **Do not install `trustflow-sdk`.** That name is an unrelated logging package. Scaffold a domain with `npx @trustflow/cli@latest init`.

## Install

```bash
npx @trustflow/cli@latest init
npx -y @trustflow/mcp-server
```

Run `npx @trustflow/cli@latest init`. Binary: `agentic-trust-mcp`.

### Upgrade from 1.x

`audit_domain` no longer accepts a `baseUrl` tool argument (use `TRUSTFLOW_API_URL` or the server `apiBase` option). `generate_did_keys` and `sign_llms_txt` require `privateKeyPath` and do not return the private key. `@trustflow/mcp-server` depends on `@trustflow/sdk` `^2.1.0`. See the repository [CHANGELOG.md](../../CHANGELOG.md).

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

Fetches `GET {base}/v1/verify?domain=`. Default base: `https://api.trustflow.systems`. Override the base with `TRUSTFLOW_API_URL` or the `apiBase` server option. There is no `baseUrl` tool argument.

Returns structured content:

- `status` — registry status (`VERIFIED`, `UNVERIFIED`, or `RISK`)
- `isVerified` — `true` when the registry says so, or when `status` is `VERIFIED`
- `audit.score` — TrustScore (`audit.score`, or a top-level `trustScore` when that is all the payload has)
- `audit.factors` — score factors from the Trustflow Domain Audit
- `domain` — the hostname that was asked, even if the body names another host

### `generate_did_keys`

Arguments: `domain`, optional `algorithm` (`Ed25519` default, or `ES256` / `P-256`), required `privateKeyPath`.

Ed25519 generation and the JWS proof both go through `createSignedDidDocument`. ES256 generates a P-256 PKCS#8 key and passes it into that same SDK function.

The private key is written to a new file at `privateKeyPath` (mode `0600`) inside the server root. An existing file is not replaced. The tool result includes `didJson` (public, suitable for `.well-known/did.json`) and does not include `privateKeyPem`.

### `sign_llms_txt`

Arguments: `domain`, `privateKeyPath`, and `llmsTxt` or `llmsTxtPath`. Optional `outputDir`. All paths must be inside the server root. `llmsTxtPath` must name a file called `llms.txt`. The manifest must not name another domain.

The SDK signs a `did:web` document whose `LinkedDomains` service endpoint is `https://<domain>/.well-known/llms.txt` and whose `llmsTxtSha256` is the hash of the aligned body. That document is the Trustflow signature for the manifest, matching `@trustflow/cli`. The returned `llms.txt` keeps the caller's prose and names the same `did:web`. The private key is read from disk and is never returned.

`outputDir` overwrites public files there: `llms.txt`, `.well-known/llms.txt`, and `.well-known/did.json`. The private key is never written.

Publish those files, then register with Trustflow Systems (`POST https://api.trustflow.systems/v1/register`) via `trustflow init` or `trustflow sign`.
