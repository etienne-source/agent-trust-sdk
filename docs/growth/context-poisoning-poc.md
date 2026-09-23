# Context poisoning, and the check that blocks it

This note is for builders adding AgenticTrust to an agent. It describes how unsigned domain context can influence a model, then shows `@trustflow/vercel-ai-middleware` refusing that context. It is security education. It is not an attack procedure, and it does not include a hostile manifest or steps for publishing one.

**AgenticTrust** is the protocol and the middleware. **Trustflow Systems** is the hosted registry at [trustflow.systems](https://trustflow.systems).

## Threat model

Agents often load text from a hostname before they answer: `llms.txt`, a tool description, or another document served as domain context. The fetch looks like a normal web request. The risk is what happens next. If the host has no `did:web` signature, nothing binds those bytes to a key the agent trusts. The model then treats the body as instructions from "the site."

Two situations fall out of that:

- **Unverified.** The domain has no usable AgenticTrust signature. `verifyDomain` does not return `VERIFIED`. The file may be empty, missing, or simply unsigned. The agent still must not parse it as trusted context.
- **Tampered.** A signature was published, but the bytes no longer match the Ed25519 or P-256 JWS. The SDK reports `RISK`. A failed signature is not a softer form of success.

In both cases the influence is the same class of problem as running an unsigned script: the content arrives with the authority of a domain name, and the domain was never authenticated. Context signing is the TLS check for that fetch. Authenticate the host, then read the file.

This document stops there. It does not show how to write a misleading `llms.txt`, how to host one, or how to point an agent at one.

## What the middleware blocks

`@trustflow/vercel-ai-middleware` defaults to audit mode. `loadLlmsFromUrl`, `fetch` of an `llms.txt` URL, and `wrapGenerate` / `wrapStream` call the verifier first. Unverified or tampered context does not throw. It logs `[AgenticTrust Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.` and does not parse `llms.txt`. `{ strict: true }` throws `UnverifiedDomainContextError` before the response body is downloaded and before `llms.txt` is parsed. The model call does not start.

The error message is the AgenticTrust Security Error:

```text
[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for unsigned.example. Execution blocked.
```

`status` is `UNVERIFIED` or `RISK`. The default mode is `audit`. Set `strict: true` when the agent must stop.

## Example: the block

The `verify` function below is a test double. It stands in for `@trustflow/sdk` reporting that the domain is not verified. It does not contact a remote host, and it does not supply file contents.

```ts
import { agenticTrustVercelAiMiddleware } from "@trustflow/vercel-ai-middleware";

const trust = agenticTrustVercelAiMiddleware({
  strict: true,
  verify: async () => ({
    verified: false,
    securityWarning: true,
    domain: "unsigned.example",
    status: "UNVERIFIED",
    warning: "Domain is not verified or has no AgenticTrust signature",
  }),
});

try {
  await trust.loadLlmsFromUrl("https://unsigned.example/llms.txt");
} catch (error) {
  console.error(error.name);
  console.error(error.message);
}
```

That catch prints `UnverifiedDomainContextError` and the AgenticTrust Security Error above. `contextFetch` is not called, so the body is never read.

A tampered document is the same call with the double returning `status: "RISK"` (the JWS did not verify). The throw still happens before the file is parsed. Production code omits `verify`. The middleware then uses `agenticTrustMiddleware` from `@trustflow/sdk`, which checks `https://<domain>/.well-known/did.json` and, when the local proof is not authoritative, `GET https://api.trustflow.systems/v1/verify?domain=`.

Install from GitHub until the npm scope exists:

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk github:etienne-source/agent-trust-sdk#path:/packages/vercel-ai-middleware
```

Do not install the unrelated `trustflow-sdk` package.

## What to ship instead

- Publish a real `did:web` document with `npx trustflow init` from `@trustflow/cli`. A file whose `proof.jws` is `REPLACE_ME` is a placeholder, not a signature, and it does not make a domain `VERIFIED`.
- Keep the private key in `.agentic-trust/` (mode `0600`, gitignored). Do not put it in the pull request or in `did.json`.
- Use `{ strict: true }` when unsigned context must throw. The package default is audit mode.
- Treat `RISK` as a block, including a disallowed JWS `alg` (`none`, any `HS*`). See [SPEC.md](../../SPEC.md).
