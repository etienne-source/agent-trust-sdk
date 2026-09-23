# @trustflow/vercel-ai-middleware

Fetch and language-model middleware for the Vercel AI SDK. The default mode is audit. Unverified, unsigned, or tampered **AgenticTrust** domain context does not throw. The middleware logs a security alert, emits a telemetry event, and does not parse `llms.txt`. `{ strict: true }` or `{ mode: "strict" }` rejects that context before a response stream starts and before `llms.txt` is parsed.

Verification and signing stay in `@trustflow/sdk` (`agenticTrustMiddleware`). The hosted registry is Trustflow Systems (`https://api.trustflow.systems`).

**License:** MIT

> **Do not install `trustflow-sdk`.** That name is an unrelated package. Scaffold a domain with `npx @trustflow/cli@latest init`.

## Install

```bash
npx @trustflow/cli@latest init
npm install @trustflow/vercel-ai-middleware @trustflow/sdk
```

### Contributors

Clone and `pnpm install` apply only when changing this monorepo. They are not the product install.

`ai` is an optional peer dependency. Pass `fetch` to a provider and the middleware object to `wrapLanguageModel`. This package does not import `ai`.

## Use

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { agenticTrustVercelAiMiddleware } from "@trustflow/vercel-ai-middleware";

const trust = agenticTrustVercelAiMiddleware({
  verificationApiUrl: "https://api.trustflow.systems",
  // strict: true,
});

const openai = createOpenAI({ fetch: trust.fetch });

const model = wrapLanguageModel({
  model: openai("gpt-5.5"),
  middleware: trust,
});

const result = await generateText({
  model,
  prompt: "Summarize the verified domain context.",
});

const stream = streamText({
  model,
  prompt: "Summarize the verified domain context.",
});

const llms = await trust.loadLlmsFromUrl("https://example.com/llms.txt");
// llms.text starts with "Verified by AgenticTrust | trustflow.systems"
```

`trust.fetch` forwards ordinary provider URLs (for example `api.openai.com`) without a domain check. A request is domain context when the path ends in `llms.txt`, or when the request sets `x-agentic-trust-context: llms.txt` or `x-agentic-trust-context: domain`. Those requests call the SDK first. In audit mode the fetch continues, the trust header is not set, and the alert below is logged. In strict mode `UnverifiedDomainContextError` is thrown before `contextFetch` runs, so the response body is never read.

```ts
import { UnverifiedDomainContextError } from "@trustflow/vercel-ai-middleware";

try {
  await trust.loadLlmsFromUrl("https://unsigned.example/llms.txt");
} catch (err) {
  if (err instanceof UnverifiedDomainContextError) {
    // err.domain, err.status ("UNVERIFIED" | "RISK"), err.reason
    // "[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for unsigned.example. Execution blocked."
  }
}
```

`transformParams` rewrites `llms.txt` envelopes in `prompt` or `messages` after verification, which is what `wrapLanguageModel` applies before `doGenerate` and `doStream`. `wrapGenerate` and `wrapStream` run the same check. Strict mode does not call the model when the domain is unsigned. Audit mode calls it and does not parse the body. `readVerifiedLlms({ target, content })` is the in-memory form of `loadLlmsFromUrl`: the `content` function is not called when verification fails.

Verified fetches keep the original body stream and set `x-agentic-trust` to `{ "verified": true, "domain", "trustScore" }`.

The SDK lookup uses the `fetch` option (registry and `did:web`). The context download uses `contextFetch`, which defaults to global `fetch`.

The default is audit mode (`mode: "audit"`). `fetch`, `transformParams`, `wrapGenerate`, `wrapStream`, `loadLlmsFromUrl`, and `readVerifiedLlms` warn and continue without parsing. The console warning and the telemetry `message` are:

```text
[AgenticTrust Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.
```

Pass `onAudit` to receive that event. There is no network call. `{ strict: true }`, `{ mode: "strict" }`, or `{ failClosed: true }` throws before execution. The thrown message is:

```text
[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.
```

Signing the files those checks read, without a local terminal, is `@trustflow/vercel-plugin`: set `AGENTIC_TRUST_PRIVATE_KEY` and `AGENTIC_TRUST_DOMAIN` in the Vercel project environment and use `buildCommand` `agentic-trust-vercel && next build`. The private key is not committed. See [packages/vercel-plugin](../vercel-plugin/README.md).
