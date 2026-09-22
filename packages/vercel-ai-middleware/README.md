# @agentic-trust/vercel-ai-middleware

Fetch and language-model middleware for the Vercel AI SDK. It rejects unverified or unsigned **AgenticTrust** domain context before a response stream starts and before `llms.txt` is parsed.

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
    // "Blocked unverified domain context for unsigned.example: ... Refusing to parse llms.txt."
  }
}
```

`transformParams` rewrites `llms.txt` envelopes in `prompt` or `messages` after verification, which is what `wrapLanguageModel` applies before `doGenerate` and `doStream`. `wrapGenerate` and `wrapStream` run the same check and do not call the model when it fails. `readVerifiedLlms({ target, content })` is the in-memory form of `loadLlmsFromUrl`: the `content` function is not called when verification fails.

Verified fetches keep the original body stream and set `x-agentic-trust` to `{ "verified": true, "domain", "trustScore" }`.

The SDK lookup uses the `fetch` option (registry and `did:web`). The context download uses `contextFetch`, which defaults to global `fetch`.
