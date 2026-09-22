# @agentic-trust/vercel-ai-middleware

Fetch and language-model middleware for the Vercel AI SDK. It is fail-closed by default. It rejects unverified, unsigned, or tampered **AgenticTrust** domain context before a response stream starts and before `llms.txt` is parsed.

Verification and signing stay in `@agentic-trust/sdk` (`agenticTrustMiddleware`). The hosted registry is Trustflow Systems (`https://api.trustflow.systems`).

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Do not install `trustflow-sdk`.** That name is an unrelated package. Install from GitHub: `github:etienne-source/agent-trust-sdk`.

## Install

`@agentic-trust/vercel-ai-middleware` depends on `@agentic-trust/sdk` with `workspace:*`, same as the CLI. Add the SDK from GitHub as well. Inside a clone of this repository, `pnpm install` links the workspace package.

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk github:etienne-source/agent-trust-sdk#path:/packages/vercel-ai-middleware
```

`ai` is an optional peer dependency. Pass `fetch` to a provider and the middleware object to `wrapLanguageModel`. This package does not import `ai`.

## Use

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { agenticTrustVercelAiMiddleware } from "@agentic-trust/vercel-ai-middleware";

const trust = agenticTrustVercelAiMiddleware({
  verificationApiUrl: "https://api.trustflow.systems",
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

`trust.fetch` forwards ordinary provider URLs (for example `api.openai.com`) without a domain check. A request is domain context when the path ends in `llms.txt`, or when the request sets `x-agentic-trust-context: llms.txt` or `x-agentic-trust-context: domain`. Those requests call the SDK first. `UnverifiedDomainContextError` is thrown before `contextFetch` runs, so the response body is never read.

```ts
import { UnverifiedDomainContextError } from "@agentic-trust/vercel-ai-middleware";

try {
  await trust.loadLlmsFromUrl("https://unsigned.example/llms.txt");
} catch (err) {
  if (err instanceof UnverifiedDomainContextError) {
    // err.domain, err.status ("UNVERIFIED" | "RISK"), err.reason
    // "[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for unsigned.example. Execution blocked."
  }
}
```

`transformParams` rewrites `llms.txt` envelopes in `prompt` or `messages` after verification, which is what `wrapLanguageModel` applies before `doGenerate` and `doStream`. `wrapGenerate` and `wrapStream` run the same check and do not call the model when it fails. `readVerifiedLlms({ target, content })` is the in-memory form of `loadLlmsFromUrl`: the `content` function is not called when verification fails.

Verified fetches keep the original body stream and set `x-agentic-trust` to `{ "verified": true, "domain", "trustScore" }`.

The SDK lookup uses the `fetch` option (registry and `did:web`). The context download uses `contextFetch`, which defaults to global `fetch`.

`failClosed` defaults to `true`. `fetch`, `transformParams`, `wrapGenerate`, and `wrapStream` throw before execution. Set `failClosed: false` only to let those hooks continue without marking the payload verified and without parsing it. `loadLlmsFromUrl` and `readVerifiedLlms` still throw. The thrown message is:

```text
[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.
```

Signing the files those checks read, without a local terminal, is `@agentic-trust/vercel-plugin`: set `AGENTIC_TRUST_PRIVATE_KEY` and `AGENTIC_TRUST_DOMAIN` in the Vercel project environment and use `buildCommand` `agentic-trust-vercel && next build`. The private key is not committed. See [packages/vercel-plugin](../vercel-plugin/README.md).
