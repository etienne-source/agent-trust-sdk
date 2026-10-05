# Changelog

## 2.1.0

Lockstep version of `@trustflow/sdk`, `@trustflow/cli`, `@trustflow/mcp-server`, `@trustflow/next-plugin`, and `@trustflow/vercel-plugin`. The behaviour change is in `@trustflow/sdk`.

### Breaking

`verifyDomain` and `agenticTrustMiddleware` no longer return `VERIFIED` for a valid local did:web signature unless the Trustflow registry confirms a proved listing whose key and `llmsTxtSha256` match the domain. When the registry is unreachable, the result is `UNVERIFIED` with `signature: "VALID"` and `claims.registryStatus: "unreachable"`. A reachable registry that does not return `VERIFIED` is the same `UNVERIFIED` result. Registry `RISK`, a different registered key, or a different registered `llmsTxtSha256` is still `RISK`.

`allowSelfSignedOffline: true` on `verifyDomain` or `agenticTrustMiddleware` keeps the 2.0.0 offline `VERIFIED` result. The default is fail-closed. That option does not override a reachable registry answer.

Do not publish this version until QA passes.

## 2.0.0

Major release of `@trustflow/sdk`, `@trustflow/cli`, and `@trustflow/mcp-server` (lockstep `@trustflow/next-plugin` and `@trustflow/vercel-plugin` are also 2.0.0).

### Breaking

- `@trustflow/sdk` no longer exports `llmsContext` or `audit`.
- `signBuildArtifacts` requires `llmsTxtSha256`.
- `@trustflow/mcp-server` tool arguments changed: `audit_domain` has no `baseUrl`; `generate_did_keys` and `sign_llms_txt` take `privateKeyPath` and do not return the private key.

### Confirm

`trustflow init --confirm`, `trustflow sign --confirm`, and `trustflow confirm` send a private-key `proofJws` (compact JWS, payload `{ purpose: "trustflow-register-confirm", domain, challengeToken }`). The PEM is not sent or printed.
