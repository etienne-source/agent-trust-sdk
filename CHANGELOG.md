# Changelog

## 2.0.1

Patch of `@trustflow/sdk`, `@trustflow/cli`, `@trustflow/mcp-server`, `@trustflow/next-plugin`, and `@trustflow/vercel-plugin`. This is 2.0.1, not 2.1.0: there is no new option. It closes the 2.0.0 fail-open.

### Fixed

`VERIFIED` means the local did:web proof is ok and the registry `status` is `VERIFIED` with the same `publicKeyHash`. A registry listing alone is not `VERIFIED`. Registry unreachable, 5xx, timeout, bad JSON, a bad API base, or an unknown status is `UNVERIFIED`. A valid local signature in that case has `signature: "VALID"`. Registry `RISK` and a different key stay `RISK`. There is no offline opt-in.

`audit_domain` uses that same verdict. `generate_did_keys` returns a key pair only; signing is `sign_llms_txt`.

Do not publish this version until QA passes.

## 2.0.0

Major release of `@trustflow/sdk`, `@trustflow/cli`, and `@trustflow/mcp-server` (lockstep `@trustflow/next-plugin` and `@trustflow/vercel-plugin` are also 2.0.0).

### Breaking

- `@trustflow/sdk` no longer exports `llmsContext` or `audit`.
- `signBuildArtifacts` requires `llmsTxtSha256`.
- `@trustflow/mcp-server` tool arguments changed: `audit_domain` has no `baseUrl`; `generate_did_keys` and `sign_llms_txt` take `privateKeyPath` and do not return the private key.

### Confirm

`trustflow init --confirm`, `trustflow sign --confirm`, and `trustflow confirm` send a private-key `proofJws` (compact JWS, payload `{ purpose: "trustflow-register-confirm", domain, challengeToken }`). The PEM is not sent or printed.
