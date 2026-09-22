# @agentic-trust/langchain-middleware

LangChain.js middleware that checks an **AgenticTrust** domain signature before it reads or parses `llms.txt` context. Unsigned, unverified, and RISK domains throw `UnverifiedDomainContextError`.

Verification and signing stay in `@agentic-trust/sdk` (`agenticTrustMiddleware`). This package only decides whether context is allowed to be parsed. The hosted registry is Trustflow Systems (`https://api.trustflow.systems`).

**License:** MIT · **Install:** GitHub only, until the npm scope exists

> **Do not install `trustflow-sdk`.** That name is an unrelated package. Install from GitHub: `github:etienne-source/agent-trust-sdk`.

## Install

`@agentic-trust/langchain-middleware` depends on `@agentic-trust/sdk` with `workspace:*`, same as the CLI. Add the SDK from GitHub as well. Inside a clone of this repository, `pnpm install` links the workspace package.

```bash
pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk github:etienne-source/agent-trust-sdk#path:/packages/langchain-middleware
```

`langchain` is an optional peer dependency. The middleware object is the argument to `createMiddleware` from `langchain`. This package does not import `langchain`.

## Use

```ts
import { createAgent, createMiddleware } from "langchain";
import { agenticTrustLangChainMiddleware } from "@agentic-trust/langchain-middleware";

const trust = agenticTrustLangChainMiddleware({
  verificationApiUrl: "https://api.trustflow.systems",
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
// context.text starts with "Verified by AgenticTrust | trustflow.systems"
```

`content` may be a string or a function. The function runs only after `verified === true`. A failed check throws before that call:

```ts
import { UnverifiedDomainContextError } from "@agentic-trust/langchain-middleware";

try {
  await trust.loadLlmsContext({
    target: "https://unsigned.example/llms.txt",
    content: () => unsignedBody,
  });
} catch (err) {
  if (err instanceof UnverifiedDomainContextError) {
    // err.domain, err.status ("UNVERIFIED" | "RISK"), err.reason
    // "Blocked unverified domain context for unsigned.example: ... Refusing to parse llms.txt."
  }
}
```

`beforeModel` and `wrapModelCall` scan agent messages for `llms.txt` payloads (`llmsTxt` plus a URL or domain, a LangChain document whose `metadata.source` is an `llms.txt` URL, or a JSON envelope in message text). Every domain is verified before any body is read. `wrapToolCall` does the same for tool arguments, and also for a bare `llms.txt` URL or `did:web` id, so the tool does not run when the domain is unsigned.

Other tool arguments are left alone. `fetch` to a model provider is not a domain-context payload.

`assertVerifiedDomain("example.com")` is the same check without parsing.
