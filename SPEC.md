# Trustflow specification

This document describes the behavior implemented in this repository (`packages/sdk`, and the CLI that calls it) and, by reference, the domain-proof fetch used by the hosted Trustflow Systems API. It does not add routes, functions, or options that those packages do not export.

**Trustflow** is the open protocol, the SDK, the CLI, the MCP server, the Next.js plugin, and the framework middleware in this repository.

**Trustflow Systems** is the hosted registry. The site is [https://trustflow.systems](https://trustflow.systems). The API origin is `https://api.trustflow.systems`. The site paths `https://trustflow.systems/api` and `https://trustflow.systems/api/register` (and the `www` host of those paths) are aliases of that API origin in `@trustflow/cli`. They are not a second server.

Badge text, when a badge is shown, is `Verified Domain Context | Trustflow`. The link target the CLI generates is `https://trustflow.systems/verify/<domain>`.

## 1. W3C `did:web` identity

Trustflow identifies a domain with the [W3C `did:web` method](https://w3c-ccg.github.io/did-method-web/) in the hostname form only.

| Input | Result |
|-------|--------|
| Hostname or URL | `normalizeDomain` lowercases `URL.hostname`. A missing scheme is treated as `https://`. The path and port are not kept. |
| DID id | `did:web:<hostname>` from `didWebId`. Example: `did:web:example.com`. |
| DID document URL | `https://<hostname>/.well-known/did.json` from `wellKnownDidUrl`. |
| Default manifest URL | `https://<hostname>/.well-known/llms.txt` from `wellKnownLlmsUrl`. |

This SDK does not produce path-form `did:web` identifiers (`did:web:example.com:user:alice` → `https://example.com/user/alice/did.json`) and does not percent-encode a port into the DID. `domainFromTarget` in the middleware, given a `did:web:` string, uses the first colon-separated label after the method as the host.

`createSignedDidDocument` (`packages/sdk/src/identity.ts`) builds the document. Generated keys are Ed25519. A caller may pass an unencrypted PKCS#8 PEM that is Ed25519 or P-256. The function returns the private key to the caller. It does not write files.

Published document:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:example.com",
  "verificationMethod": [
    {
      "id": "did:web:example.com#key-1",
      "type": "JsonWebKey2020",
      "controller": "did:web:example.com",
      "publicKeyPem": "<SPKI PEM>"
    }
  ],
  "assertionMethod": ["did:web:example.com#key-1"],
  "service": [
    {
      "id": "did:web:example.com#llms",
      "type": "LinkedDomains",
      "serviceEndpoint": "https://example.com/.well-known/llms.txt"
    }
  ],
  "proof": {
    "type": "JsonWebSignature2020",
    "created": "<ISO-8601 timestamp>",
    "verificationMethod": "did:web:example.com#key-1",
    "jws": "<compact JWS>"
  }
}
```

Callers may pass `services` and replace that default `LinkedDomains` entry. The signer writes `publicKeyPem` (SPKI). Verifiers also accept `publicKeyJwk` on `verificationMethod[0]` when the JWK is Ed25519 or P-256 (see below). Only the first verification method is read.

`publicKeyHash`, the value the CLI sends toward the registry, is the hex SHA-256 of the SPKI PEM after CRLF is turned into LF and the string is trimmed (`hashPublicKeyPem`). Local verify claims use that same hash.

The CLI writes the public document to `.well-known/did.json` and the private key to `.agentic-trust/private-key.pem` (mode `0600`, gitignored). IDE rules from `trustflow init` also ask for `public/.well-known/did.json` (or `static/` when that directory already exists).

## 2. JWS signature for DID proofs

The proof is a compact JWS in `proof.jws`. `proof.type` on documents this SDK signs is `JsonWebSignature2020`. `verifyDidJws` does not read `proof.type`. It verifies `proof.jws`.

Signing (`SignJWT` in `createSignedDidDocument`):

- Protected header is `{ "alg": "EdDSA" }` or `{ "alg": "ES256" }`. No other header parameter is set.
- The payload is the DID object without `@context` and without `proof`: `id`, `verificationMethod`, `assertionMethod`, `service`, and optional `llmsTxtSha256`. `setIssuedAt()` adds `iat`.
- The key is the Ed25519 or P-256 private key. `alg` is `EdDSA` for Ed25519 and `ES256` for P-256 (`prime256v1`).
- `createSignedDidDocument` refuses a `publicKeyPem` that does not match the private key.

Verification (`verifyDidJws`):

1. Read the protected header with `decodeProtectedHeader`. A missing, empty, or non-string `alg` fails closed (`Invalid or missing JWS alg header`).
2. Apply the allowlist in section 3 before the signature is trusted.
3. Require the key’s algorithm to be that same allowlisted `alg` (`JWS alg does not match verification key` otherwise).
4. `compactVerify` the JWS with `algorithms` set to that single `alg`.
5. The payload must be a JSON object. `id` must equal `did.id`.
6. `verificationMethod[0]` in the payload must bind the same public key as the document (PEM, or a canonical JWK of `kty`/`crv`/`x`/`y` only). Extra JWK members such as `kid` are ignored.
7. Canonical JSON of `service` and of `assertionMethod` must match the published document. A swapped MCP endpoint that the JWS does not cover fails (`JWS payload services do not match document`).
8. When the document lists `llmsTxtSha256`, the payload must sign the same SHA-256 hex.

`assessDidDocument` then maps that result:

| Condition | Outcome |
|-----------|---------|
| Body is not a JSON object | `malformed` (callers report `RISK`) |
| `id` is set, is not `did:web:<requested host>`, and does not start with `did:web:` | `risk` — `DID id is not did:web` |
| No usable public key in `verificationMethod[0]` | `incomplete` |
| No `proof.jws` string | `incomplete` |
| `verifyDidJws` fails | `risk` |
| Signature checks pass | `verified` |

A `did:web` id for a different host is `RISK` (`DID id does not match domain`). The JWS `id` is also compared to the document `id`.

`evaluateDomainTrust` (used by `verifyDomain` and the middleware) is the one decision:

- A local `RISK` (bad JWS, swapped services, swapped or unbound `llms.txt`) is final. The registry is not queried.
- `VERIFIED` requires a local proof that passes and a registry `status` of `VERIFIED` whose `publicKeyHash` equals the key the domain serves. A registry `RISK` or a different key is `RISK`. A registry `VERIFIED` may add `trustScore` (never read from `did.json`). The registry's `llmsTxtSha256` is not consulted.
- When the registry is unreachable, returns 5xx, times out, returns bad JSON, has a bad API base, or returns an unknown status, the result is `UNVERIFIED`. A valid local signature then has `signature: "VALID"` and `claims.registryStatus: "unreachable"` when the failure is transport. It is cached briefly.
- No local proof is never `VERIFIED`. The registry answer is used only to raise `RISK`. Otherwise the result is `UNVERIFIED`.

## 3. Algorithm pinning

`ALLOWED_JWS_ALGS` is exactly `EdDSA` and `ES256`.

| `alg` | Key |
|-------|-----|
| `EdDSA` | Ed25519. JWK: `kty` `OKP`, `crv` `Ed25519`. Raw 32-byte key material maps to `EdDSA`. |
| `ES256` | ECDSA P-256 (`prime256v1` or `P-256`). JWK: `kty` `EC`, `crv` `P-256`. |

Rejected before the signature is trusted:

- `alg` `none` in any letter case, after trim (`Disallowed JWS algorithm`).
- Any `alg` matching `/^hs/i` after trim, including `HS256`, `HS384`, `HS512`, and `hs256` (`Disallowed symmetric JWS algorithm`).
- Every other `alg`, including `RS256`, `PS256`, `ES384`, and `ES512`.
- A JWK whose `alg` member is present and is not exactly the algorithm implied by `kty` / `crv`.
- RSA, Ed448, and EC curves other than P-256 (`allowedAlgForKey` returns null).

The allowlist comparison is case-sensitive after the `none` and `HS*` checks. `EdDSA` and `ES256` must match those strings. `createSignedDidDocument` will not generate or import any other key type.

## 4. Domain-proof fetch

Two different fetches exist. Only the first is code in this repository.

### 4.1 Public SDK

`fetchDidDocument` requests `GET https://<domain>/.well-known/did.json` with `Accept: application/json` and `redirect: "manual"`. One same-site hop is followed (`sameSiteRedirect`: HTTPS, same path, same host or a single apex ↔ www change). Cross-host redirects are refused. `verifyDomain` aborts that call after 8 seconds (`LOCAL_DID_TIMEOUT_MS`). A network error there is not `RISK`; the call falls through to the registry. HTTP errors are `UNVERIFIED`. Invalid JSON is `RISK`.

When the JWS verifies, the SDK GETs both `https://<domain>/.well-known/llms.txt` and `https://<domain>/llms.txt` (`redirect: "manual"`, one same-site hop, 5 second timeout). An HTML body counts as absent. A published copy whose SHA-256 (`hashLlmsTxt`: BOM and CRLF normalized, one trailing newline ignored) does not match the signed `llmsTxtSha256` is `RISK`. A published copy when the JWS does not sign a hash is `RISK` (`llms.txt is published … but did.json does not sign it`). A signed hash with nothing published is `RISK` (`Signed llms.txt is not published`).

`verifyDomain`’s registry GET uses a 10 second timeout. The default base is `VERIFICATION_API_URL`, or `https://api.trustflow.systems` when that variable is unset. The base must be HTTPS (plain HTTP only on loopback). A `domain` field in the registry body is ignored; the answer is applied to the host that was asked.

`agenticTrustMiddleware` uses one `AbortSignal` of 4 seconds (`DEFAULT_MIDDLEWARE_TIMEOUT_MS`) for one lookup (did.json, both llms.txt URLs, and the registry). Its default base is `AGENTIC_TRUST_API_URL`, then `VERIFICATION_API_URL`, then `https://api.trustflow.systems`. Timeout and transport failure set `securityWarning` and do not throw, except a local `RISK` stays `RISK`. An `llms.txt` body returned through `fetch`, `annotateDocuments`, or a wrapped tool is still delivered. If it is unsigned or does not match the signed hash, the metadata is annotated `RISK`. The middleware does not reject or strip that body. Middleware cache TTL is 5 minutes for a successful lookup and 15 seconds for a transport failure. A warm in-memory hit for `verifyDomain` or the middleware stays under 5ms. `AGENTIC_TRUST_CACHE_DIR` is an optional disk copy of those public results. A cache directory or file that another user can write, or a record that is not a verify result, is ignored.

`inspectEndpointBeforeExecution` allows the call only when the endpoint URL’s protocol is `https:`, `verifyDomain` on that hostname is `VERIFIED`, and the URL is one of the MCP service endpoints signed into `did.json`. When that list is empty, every endpoint is blocked (`Domain did.json lists no MCP service endpoints`). This HTTPS check is a string check on the URL. It is not the registry fetcher below.

`@trustflow/cli` POSTs to the registry with a default 20 second timeout (`TRUSTFLOW_API_TIMEOUT_MS`). That client does not fetch the domain’s proof.

### 4.2 Hosted registry `safeFetch` (private API, by reference)

`safeFetch` is not exported by `@trustflow/sdk` or by any other package in this repository. It is the domain-proof fetch in the private Trustflow Systems API: the fetch the registry uses when it retrieves a domain’s proof from the public web. This repository does not contain that implementation, so this section does not define a function signature, option bag, or error type for it.

The registry fetcher applies these SSRF limits:

1. **HTTPS only.** The proof URL is `https:`. Other schemes are refused.
2. **DNS public-IP checks.** The hostname is resolved before the connection. An address that is not publicly routable is refused, including loopback, link-local, and private-range answers.
3. **4 second timeout.** The proof fetch aborts at 4 seconds.
4. **At most one apex ↔ www redirect, same path.** One redirect may be followed, and only when the host changes between the apex and `www` of that same name while the path stays the same. A second hop, a different host, a different path, or a scheme change is refused.

The SDK timeouts in section 4.1 are client deadlines. They are not this registry fetcher. In particular, the middleware’s 4 second budget and `safeFetch`’s 4 second budget are separate clocks.

## 5. Status values

`verifyDomain` and `inspectEndpointBeforeExecution` return `VERIFIED`, `UNVERIFIED`, or `RISK`.

| Status | When the SDK uses it |
|--------|----------------------|
| `VERIFIED` | Local `did:web` JWS verifies, published `llms.txt` (if any) matches the signed hash, and the registry `status` is `VERIFIED` with the same `publicKeyHash`. |
| `UNVERIFIED` | Invalid domain, HTTP error from `did.json`, missing key or missing JWS, no local proof, the registry is unreachable or returns a non-status payload, the registry omits `publicKeyHash`, or a valid local signature has no proved listing (`signature: "VALID"`). |
| `RISK` | `did.json` is not JSON or not an object, the id is not `did:web`, the JWS fails (including disallowed `alg` or unbound services/key), a published `llms.txt` is unsigned or swapped, the registry marked the domain `RISK`, the registered key differs, or the endpoint is not HTTPS. |

`claims.registryStatus` is set when a valid local signature is combined with the registry (`VERIFIED`, `UNVERIFIED`, `RISK`, or `unreachable`). `trustScore` is copied from the registry only. `signature: "VALID"` is set when that local signature is not promoted to `VERIFIED`.

`agenticTrustMiddleware` does not throw on `UNVERIFIED` or `RISK`. Call `verifyDomain` and refuse the tool when the status is not `VERIFIED`.

Build signers (`signBuildArtifacts`, `renewBuildSignatures`, `@trustflow/vercel-plugin`) require `llmsTxtSha256` and sign the published `llms.txt` copies. Those copies must be identical and must name this domain. The preview `VERCEL_URL` is not used as the signing hostname.

## 6. Registry HTTP the clients call

These are the routes the CLI, SDK, and MCP server request. No other registry route is implemented here.

| Method | URL | Caller |
|--------|-----|--------|
| `GET` | `https://api.trustflow.systems/health` | Documented operational check. Not called by the SDK. |
| `POST` | `https://api.trustflow.systems/v1/register` | `trustflow init` and `trustflow sign` |
| `POST` | `https://api.trustflow.systems/v1/register/confirm` | `trustflow confirm` |
| `GET` | `https://api.trustflow.systems/v1/verify?domain=` | `verifyDomain` fallback, middleware, `audit_domain` |

`POST /v1/register` from the CLI sends `domain`, `businessName`, `verificationType` (`SSL_CHALLENGE` or `DNS_TXT`), `did`, SPKI `publicKeyPem`, `publicKeyHash`, `manifestUrl` (`https://<domain>/.well-known/did.json`), and `services`. The response fields the CLI requires are `challengeToken`, `instructions`, and `domain`. When `verificationType` is `SSL_CHALLENGE` or `challengePath` is set, the CLI writes `.well-known/agentic-trust-challenge.txt` with the token as the file body. When the response includes `dnsRecord`, the CLI prints `dnsRecord.name` and `dnsRecord.value` and does not invent that record. Confirm sends `domain`, `challengeToken`, and `proofJws` — a compact JWS (`EdDSA` or `ES256`) whose payload is exactly `{ purpose: "trustflow-register-confirm", domain, challengeToken }`, signed with the did:web private key. The field name `proof` is ignored by the API and is not sent. The private key is not sent and is not printed. A proved verified listing returns `409 VERIFIED_LISTING_LOCKED` and is not overwritten. No API token is required by the CLI.

The public verify page linked from the badge is `https://trustflow.systems/verify/<domain>`. That page is not an API.

## 7. Exports

Signing and checking in this repository go through:

- `createSignedDidDocument`, `hashPublicKeyPem`, `publicKeyPemFromPrivate`, `signRegisterConfirmProof`
- `verifyDidJws`, `importPublicKey`, `allowedAlgForKey`, `ALLOWED_JWS_ALGS`
- `verifyDomain`, `inspectEndpointBeforeExecution`, `clearVerifyCache`
- `fetchDidDocument`, `assessDidDocument` (used internally; the package entry exports the verify and sign functions above)
- `agenticTrustMiddleware`
- CLI: `trustflow init`, `trustflow confirm`, `trustflow sign`
- MCP tools: `audit_domain` (no `baseUrl` argument; API base is a server option), `generate_did_keys` (`privateKeyPath` inside the server root; the private key is not returned), `sign_llms_txt` (`privateKeyPath` and paths inside the server root)

`safeFetch` is not one of these exports.
