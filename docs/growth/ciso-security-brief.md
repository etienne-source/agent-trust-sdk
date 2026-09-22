# AgenticTrust security brief

Enterprise summary of the behavior in [SPEC.md](../../SPEC.md) and the public README. **AgenticTrust** is the open protocol, SDK, CLI, MCP server, Next.js plugin, and framework middleware in this repository. **Trustflow Systems** is the hosted registry (`https://trustflow.systems`, API origin `https://api.trustflow.systems`).

This brief does not add controls that the code does not implement. `safeFetch` is described as the registry's private domain-proof fetch. It is not exported by `@agentic-trust/sdk`.

## Identity

A domain is named with W3C `did:web` in hostname form only: `did:web:<hostname>`, published at `https://<hostname>/.well-known/did.json`. The default manifest URL is `https://<hostname>/.well-known/llms.txt`. The SDK does not issue path-form DIDs and does not encode a port into the identifier.

`createSignedDidDocument` builds the document. Generated keys are Ed25519. A caller may pass an unencrypted PKCS#8 PEM that is Ed25519 or P-256. The private key is returned to the caller. The CLI stores it at `.agentic-trust/private-key.pem` with mode `0600` and gitignores that directory. The published document contains the public key and a compact JWS in `proof.jws`. `publicKeyHash` is the hex SHA-256 of the normalized SPKI PEM and is what the CLI sends toward the registry.

## Signatures and algorithm pinning

Documents this SDK signs use `proof.type` `JsonWebSignature2020`. Verifiers check `proof.jws`, not the type string.

`ALLOWED_JWS_ALGS` is exactly `EdDSA` and `ES256`.

| `alg` | Key |
|-------|-----|
| `EdDSA` | Ed25519 (`OKP` / `Ed25519`) |
| `ES256` | ECDSA P-256 |

Rejected before the signature is trusted:

- `alg` `none`, any letter case, after trim.
- Any `alg` matching `/^hs/i`, including `HS256`, `HS384`, `HS512`, and `hs256`.
- Every other algorithm, including `RS256`, `PS256`, `ES384`, and `ES512`.
- A JWK whose `alg` member is present and is not the algorithm implied by `kty` and `crv`.
- RSA, Ed448, and EC curves other than P-256.

The protected header is `{ "alg": "EdDSA" }` or `{ "alg": "ES256" }` with no other header parameter. Verification decodes that header, applies the allowlist, requires the key algorithm to match, and calls `compactVerify` with that single algorithm. If the payload is JSON and contains `id`, that `id` must equal the document `id`.

`verifyDomain` treats a local `VERIFIED` and a local `RISK` as final. A local `RISK` is not replaced by a registry `VERIFIED`. `agenticTrustMiddleware` does not throw on `UNVERIFIED` or `RISK`. The LangChain and Vercel AI middleware packages do: `failClosed` defaults to `true`, and they throw `UnverifiedDomainContextError` before unsigned or tampered `llms.txt` is parsed. The message is `[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.`

## Domain-proof fetch and `safeFetch` (SSRF)

Two fetches are specified. Only the SDK client is code in this repository.

The public SDK `fetchDidDocument` requests `GET https://<domain>/.well-known/did.json` with redirects followed. It does not resolve DNS itself and does not filter private addresses. `verifyDomain` aborts that call after 8 seconds. A network error is not `RISK`; the call falls through to the registry. `softFetchLlms` uses a 5 second timeout. The registry GET uses a 10 second timeout. `agenticTrustMiddleware` uses one 4 second abort signal for its local DID read and, if needed, the registry verify call. Those client deadlines are not the registry fetcher below.

`safeFetch` is the domain-proof fetch in the private Trustflow Systems API: the fetch the registry uses when it retrieves a domain's proof from the public web. This repository does not contain that implementation. As specified publicly, the registry fetcher applies these SSRF limits:

1. **HTTPS only.** The proof URL is `https:`. Other schemes are refused.
2. **DNS public-IP checks.** The hostname is resolved before the connection. An address that is not publicly routable is refused, including loopback, link-local, and private-range answers.
3. **4 second timeout.** The proof fetch aborts at 4 seconds.
4. **At most one apex ↔ www redirect, same path.** One redirect may be followed, and only when the host changes between the apex and `www` of that same name while the path stays the same. A second hop, a different host, a different path, or a scheme change is refused.

The middleware's 4 second budget and `safeFetch`'s 4 second budget are separate clocks. `inspectEndpointBeforeExecution` allows a call only when the endpoint URL's protocol is `https:` and `verifyDomain` on that hostname is `VERIFIED`. If the DID lists MCP service endpoints, the URL must be one of them. That HTTPS check is a string check on the URL. It is not `safeFetch`.

## Registry boundary

Clients in this repository call `POST /v1/register`, `POST /v1/register/confirm`, and `GET /v1/verify?domain=` on `https://api.trustflow.systems`. The public verify page is `https://trustflow.systems/verify/<domain>`. Badge text is `Verified by AgenticTrust | trustflow.systems`. No API token is required by the CLI for registration.

`notifyVerifiedDomain` POSTs to `VERIFIED_NOTIFY_WEBHOOK` only when a caller already reports status `VERIFIED` with score 100/100. Hosts under `x.com` and `twitter.com` are refused. The helper does not post to X.

`scripts/submit-ecosystem-prs.mjs` is dry-run unless `--apply` and an explicit targets file are both set. `--apply` requires `GITHUB_TOKEN` or `GH_TOKEN`, forks (or updates an existing fork of) allowlisted repositories only, and does not search GitHub. The example allowlist is empty. LangChain, LlamaIndex, and Next.js AI boilerplates are named in documentation as examples of repository shape, not as targets.

## Audit guidelines

Review a deployment or a pull request against the following. Each item maps to behavior already described in SPEC.md or the README.

1. **Algorithm allowlist.** Confirm verifiers still reject `none` and `HS*` before `compactVerify`, and that `ALLOWED_JWS_ALGS` remains `EdDSA` and `ES256` only.
2. **Fail closed.** Confirm framework middleware keeps `failClosed` defaulting to `true`, and that unsigned or `RISK` context throws `UnverifiedDomainContextError` before `llms.txt` is parsed.
3. **Key handling.** Confirm private keys stay in `.agentic-trust/` or a host secret such as `AGENTIC_TRUST_PRIVATE_KEY`. Diffs must not contain `BEGIN PRIVATE KEY` or `.agentic-trust/private-key.pem`. Placeholder `did.json` files must keep `proof.jws` as `REPLACE_ME` until a maintainer runs `npx agentic-trust init`.
4. **Package name.** Confirm install instructions use `github:etienne-source/agent-trust-sdk`. Reject documentation that says `npm install trustflow-sdk`.
5. **Registry SSRF.** For the hosted API, review the private `safeFetch` implementation against the four limits above (HTTPS, public DNS answers, 4 second timeout, one apex ↔ www redirect with the same path). Do not assume the SDK client applies those limits.
6. **Client timeouts.** Confirm the SDK's own deadlines (8s local DID, 5s `llms.txt`, 10s registry GET, 4s middleware) are still the client clocks, separate from `safeFetch`.
7. **Status finality.** Confirm a local `RISK` is not overwritten by a registry `VERIFIED`.
8. **Automation scope.** Confirm ecosystem and starter pull-request scripts refuse the example allowlist, refuse an empty list, refuse missing `GITHUB_TOKEN`, and do not call the GitHub search API. Confirm webhook code still refuses `x.com` and `twitter.com`.
9. **Secrets in CI.** `GITHUB_TOKEN` for `--apply`, `AGENTIC_TRUST_PRIVATE_KEY`, and webhook URLs belong in the host secret store or a gitignored env file, not in the repository.

## Out of scope for this repository

This repository does not ship a weaponized context-poisoning recipe, does not search GitHub for repositories to modify, and does not post to X. Growth drafts under `docs/growth/` are documents for builders and reviewers.
