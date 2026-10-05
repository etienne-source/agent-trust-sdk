# Changelog

## 2.0.0

Major release of `@trustflow/sdk`, `@trustflow/cli`, and `@trustflow/mcp-server` (lockstep `@trustflow/next-plugin` and `@trustflow/vercel-plugin` are also 2.0.0).

### Breaking

- `@trustflow/sdk` no longer exports `llmsContext` or `audit`.
- `signBuildArtifacts` requires `llmsTxtSha256`.
- `@trustflow/mcp-server` tool arguments changed: `audit_domain` has no `baseUrl`; `generate_did_keys` and `sign_llms_txt` take `privateKeyPath` and do not return the private key.

### Confirm

`trustflow init --confirm`, `trustflow sign --confirm`, and `trustflow confirm` send a private-key `proofJws` (compact JWS, payload `{ purpose: "trustflow-register-confirm", domain, challengeToken }`). The PEM is not sent or printed.
