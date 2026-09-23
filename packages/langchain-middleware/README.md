# @trustflow/langchain-middleware

LangChain.js middleware that checks an **Trustflow** domain signature before it reads or parses `llms.txt` context. The default mode is audit. Unsigned, unverified, tampered, and RISK domains do not throw. They log a security alert and a telemetry event, and the body is not parsed. `{ strict: true }` or `{ mode: "strict" }` throws `UnverifiedDomainContextError` and the model or tool does not run.

Verification and signing stay in `@trustflow/sdk` (`agenticTrustMiddleware`). This package only decides whether context is allowed to be parsed. The hosted registry is Trustflow Systems (`https://api.trustflow.systems`).

**License:** MIT

> **Do not install `trustflow-sdk`.** That name is an unrelated package. Scaffold a domain with `npx @trustflow/cli@latest init`.

## Install

```bash
npx @trustflow/cli@latest init
npm install @trustflow/langchain-middleware @trustflow/sdk
```

### Contributors

Clone and `pnpm install` apply only when changing this monorepo. They are not the product install.

`langchain` is an optional peer dependency. The middleware object is the argument to `createMiddleware` from `langchain`. This package does not import `langchain`.

## Use

```ts
import { createAgent, createMiddleware } from "langchain";
import { agenticTrustLangChainMiddleware } from "@trustflow/langchain-middleware";

const trust = agenticTrustLangChainMiddleware({
  verificationApiUrl: "https://api.trustflow.systems",
  // strict: true,
});

const agent = createAgent({
  model: "gpt-5.5",
  tools,
  middleware: [createMiddleware(trust)],
});

const context = await trust.loadLlmsContext({
  target: "https://example.com/llms.txt",
  content: () => llmsTxtBody,
});
// context.text starts with "Verified Domain Context | Trustflow"
```

`content` may be a string or a function. The function runs only after `verified === true`. In audit mode a failed check does not throw and does not call `content`. Strict mode throws before that call:

```ts
import { UnverifiedDomainContextError } from "@trustflow/langchain-middleware";

try {
  await trust.loadLlmsContext({
    target: "https://unsigned.example/llms.txt",
    content: () => unsignedBody,
  });
} catch (err) {
  if (err instanceof UnverifiedDomainContextError) {
    // err.domain, err.status ("UNVERIFIED" | "RISK"), err.reason
    // "[Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for unsigned.example. Execution blocked."
  }
}
```

`beforeModel` and `wrapModelCall` scan agent messages for `llms.txt` payloads (`llmsTxt` plus a URL or domain, a LangChain document whose `metadata.source` is an `llms.txt` URL, or a JSON envelope in message text). Every domain is verified before any body is read. `wrapToolCall` does the same for tool arguments, and also for a bare `llms.txt` URL or `did:web` id. Strict mode does not run the tool when the domain is unsigned. Audit mode runs it and does not parse the body.

Other tool arguments are left alone. `fetch` to a model provider is not a domain-context payload.

`assertVerifiedDomain("example.com")` is the same check without parsing.

The default is audit mode (`mode: "audit"`). `beforeModel`, `wrapModelCall`, `wrapToolCall`, `loadLlmsContext`, and `assertVerifiedDomain` warn and continue without parsing. The console warning and the telemetry `message` are:

```text
[Trustflow Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.
```

Pass `onAudit` to receive that event. There is no network call. `{ strict: true }`, `{ mode: "strict" }`, or `{ failClosed: true }` throws before the body is read. The thrown message is:

```text
[Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.
```
