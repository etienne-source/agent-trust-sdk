import path from "node:path";
import { createGithubClient, ensureGitignore, mergePackageDependency } from "./starter-prs.mjs";

export { createGithubClient };

export const MAX_TARGETS = 5;
export const ECOSYSTEM_BRANCH = "agentic-trust/framework-middleware";
export const EXAMPLE_FILENAME = "ecosystem-targets.example.json";

const SDK_SPEC = "github:etienne-source/agent-trust-sdk#path:/packages/sdk";
const LANGCHAIN_SPEC = "github:etienne-source/agent-trust-sdk#path:/packages/langchain-middleware";
const VERCEL_AI_SPEC = "github:etienne-source/agent-trust-sdk#path:/packages/vercel-ai-middleware";

export const FRAMEWORKS = [
  "langchain",
  "langgraph",
  "vercel-ai",
  "openai-agents",
  "llamaindex",
  "mastra",
];

const SECURITY_ERROR =
  "[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for ${domain}. Execution blocked.";

function installComment(specs) {
  return [
    " * Install from GitHub until the npm scope exists:",
    ` *   pnpm add ${specs.join(" ")}`,
    " * Do not install the unrelated trustflow-sdk package.",
    " * Protocol: AgenticTrust. Registry: Trustflow Systems (https://trustflow.systems).",
  ].join("\n");
}

function securityThrow() {
  return `throw new Error(\`${SECURITY_ERROR}\`);`;
}

function langchainFile() {
  return `import { agenticTrustLangChainMiddleware } from "@agentic-trust/langchain-middleware";

/**
 * Fail-closed AgenticTrust middleware for LangChain.js.
 * Unsigned or tampered llms.txt throws before it is parsed.
${installComment([SDK_SPEC, LANGCHAIN_SPEC])}
 */
export const agenticTrust = agenticTrustLangChainMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

function langgraphFile() {
  return `import { agenticTrustLangChainMiddleware } from "@agentic-trust/langchain-middleware";

/**
 * Fail-closed AgenticTrust middleware for LangGraph.
 * Pass \`agenticTrust\` to \`createMiddleware\` on the graph. Execution stops
 * when llms.txt context is unverified or tampered.
${installComment([SDK_SPEC, LANGCHAIN_SPEC])}
 */
export const agenticTrust = agenticTrustLangChainMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

function vercelAiFile() {
  return `import { agenticTrustVercelAiMiddleware } from "@agentic-trust/vercel-ai-middleware";

/**
 * Fail-closed AgenticTrust middleware for the Vercel AI SDK.
 * Pass \`fetch\` to the provider and this object to \`wrapLanguageModel\`.
${installComment([SDK_SPEC, VERCEL_AI_SPEC])}
 */
export const agenticTrust = agenticTrustVercelAiMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

function openaiFile() {
  return `import { verifyDomain } from "@agentic-trust/sdk";

/**
 * AgenticTrust check for OpenAI Agents tool URLs.
 * Call \`assertToolDomain\` before a remote tool runs.
${installComment([SDK_SPEC])}
 */
export async function assertToolDomain(url: string) {
  const domain = new URL(url).hostname;
  const result = await verifyDomain(domain, {
    verificationApiUrl: process.env.VERIFICATION_API_URL ?? "https://api.trustflow.systems",
  });
  if (result.status !== "VERIFIED") {
    ${securityThrow()}
  }
  return result;
}
`;
}

function llamaindexFile() {
  return `import { verifyDomain } from "@agentic-trust/sdk";

/**
 * AgenticTrust check for LlamaIndex source domains.
 * Call \`assertSourceDomain\` before a loader reads remote context.
${installComment([SDK_SPEC])}
 */
export async function assertSourceDomain(domain: string) {
  const result = await verifyDomain(domain, {
    verificationApiUrl: process.env.VERIFICATION_API_URL ?? "https://api.trustflow.systems",
  });
  if (result.status !== "VERIFIED") {
    ${securityThrow()}
  }
  return result;
}
`;
}

function mastraFile() {
  return `import { agenticTrustVercelAiMiddleware } from "@agentic-trust/vercel-ai-middleware";

/**
 * Fail-closed AgenticTrust middleware for Mastra agents that use the Vercel AI SDK.
 * Pass \`fetch\` to the model provider and this object to \`wrapLanguageModel\`.
${installComment([SDK_SPEC, VERCEL_AI_SPEC])}
 */
export const agenticTrust = agenticTrustVercelAiMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

const FRAMEWORK_FILES = {
  langchain: { path: "src/agentic-trust-langchain.ts", content: langchainFile, dependencies: sdkAnd(LANGCHAIN_SPEC) },
  langgraph: { path: "src/agentic-trust-langgraph.ts", content: langgraphFile, dependencies: sdkAnd(LANGCHAIN_SPEC) },
  "vercel-ai": { path: "src/agentic-trust-vercel-ai.ts", content: vercelAiFile, dependencies: sdkAnd(VERCEL_AI_SPEC) },
  "openai-agents": { path: "src/agentic-trust-openai.ts", content: openaiFile, dependencies: sdkOnly() },
  llamaindex: { path: "src/agentic-trust-llamaindex.ts", content: llamaindexFile, dependencies: sdkOnly() },
  mastra: { path: "src/agentic-trust-mastra.ts", content: mastraFile, dependencies: sdkAnd(VERCEL_AI_SPEC) },
};

function sdkOnly() {
  return { "@agentic-trust/sdk": SDK_SPEC };
}

function sdkAnd(spec) {
  const name = spec.includes("langchain")
    ? "@agentic-trust/langchain-middleware"
    : "@agentic-trust/vercel-ai-middleware";
  return { "@agentic-trust/sdk": SDK_SPEC, [name]: spec };
}

const ALLOWED_EXACT = new Set([
  "package.json",
  ".gitignore",
  ...Object.values(FRAMEWORK_FILES).map((entry) => entry.path),
]);

export function assertSafePath(filePath) {
  if (
    typeof filePath !== "string" ||
    filePath.includes("..") ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    filePath.includes("\0")
  ) {
    throw new Error(`Unsafe path: ${filePath}`);
  }
  if (ALLOWED_EXACT.has(filePath)) return filePath;
  throw new Error(`Refusing to write ${filePath}`);
}

function assertRepo(value, index) {
  const repo = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`targets[${index}].repo must be owner/name`);
  }
  return repo;
}

function assertBase(value, index) {
  const base = value === undefined ? "main" : String(value);
  if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.includes("..") || base.startsWith("/") || base.endsWith("/")) {
    throw new Error(`targets[${index}].base is not a branch name`);
  }
  return base;
}

export function normalizeTarget(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`targets[${index}] must be an object`);
  }
  if (entry.enabled !== true) {
    throw new Error(`targets[${index}] must set enabled to true`);
  }
  if (!FRAMEWORKS.includes(entry.framework)) {
    throw new Error(`targets[${index}].framework must be one of ${FRAMEWORKS.join(", ")}`);
  }
  return {
    repo: assertRepo(entry.repo, index),
    framework: entry.framework,
    base: assertBase(entry.base, index),
    enabled: true,
  };
}

export function loadAllowlist(text, sourceName) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Allowlist is not JSON (${error instanceof Error ? error.message : error})`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.targets)) {
    throw new Error("Allowlist must be a JSON object with a targets array");
  }
  if (raw.targets.length > MAX_TARGETS) {
    throw new Error(`Allowlist has ${raw.targets.length} targets; the maximum per run is ${MAX_TARGETS}`);
  }
  const seen = new Set();
  const targets = raw.targets.map((entry, index) => {
    const target = normalizeTarget(entry, index);
    if (seen.has(target.repo)) throw new Error(`Duplicate repo ${target.repo}`);
    seen.add(target.repo);
    return target;
  });
  const base = path.basename(sourceName);
  return {
    sourceName,
    example: raw.example === true || base === EXAMPLE_FILENAME,
    description: typeof raw.description === "string" ? raw.description : "",
    targets,
  };
}

function pullRequestBody(target) {
  const spec = FRAMEWORK_FILES[target.framework];
  const install = Object.values(spec.dependencies).join(" ");
  return [
    "## AgenticTrust fail-closed middleware",
    "",
    `Adds **AgenticTrust** domain checks to this ${target.framework} starter.`,
    "The hosted registry is **Trustflow Systems** (https://trustflow.systems).",
    "",
    `\`${spec.path}\` blocks unverified or tampered \`llms.txt\` context before execution.`,
    "The security error is:",
    "",
    "```text",
    "[AgenticTrust Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.",
    "```",
    "",
    "### Install",
    "",
    "```bash",
    `pnpm add ${install}`,
    "```",
    "",
    "Do not install the unrelated `trustflow-sdk` package.",
    "This change does not add a private key. Sharing on X is a separate explicit step. This change does not post to X.",
    "",
  ].join("\n");
}

export function planTarget(target) {
  const spec = FRAMEWORK_FILES[target.framework];
  const content = spec.content();
  if (content.includes("BEGIN PRIVATE KEY") || content.includes("npm install trustflow-sdk")) {
    throw new Error(`Refusing to plan ${target.framework}: unsafe snippet`);
  }
  assertSafePath(spec.path);
  return {
    repo: target.repo,
    framework: target.framework,
    base: target.base,
    branch: ECOSYSTEM_BRANCH,
    title: "Add AgenticTrust fail-closed middleware",
    body: pullRequestBody(target),
    commitMessage:
      "Add AgenticTrust fail-closed domain middleware\n\nInstalls @agentic-trust packages from GitHub. Does not add a private key.",
    files: [{ path: spec.path, content }],
    packageDependencies: spec.dependencies,
  };
}

export function planAllowlist(allowlist) {
  return allowlist.targets.map((target) => planTarget(target));
}

export function formatDryRun(allowlist, plans) {
  const lines = [
    "mode: dry-run",
    `source: ${allowlist.sourceName}`,
    `example: ${allowlist.example ? "true" : "false"}`,
    `targets: ${plans.length}`,
    "",
  ];
  if (plans.length === 0) {
    lines.push(
      "No repositories are allowlisted. Copy scripts/ecosystem-targets.example.json to scripts/ecosystem-targets.json, set \"example\" to false, and add only repositories you maintain.",
      "--apply is refused for the example file and for an empty list. This command does not search GitHub.",
      ""
    );
    return lines.join("\n");
  }
  lines.push("Dry run only. Pass --apply and --targets <allowlist.json> to open these pull requests.", "");
  plans.forEach((plan, index) => {
    lines.push(
      `# ${index + 1} ${plan.repo}`,
      `framework: ${plan.framework}`,
      `base: ${plan.base}`,
      `branch: ${plan.branch}`,
      `title: ${plan.title}`,
      "--- body ---",
      plan.body.trimEnd(),
      "--- files ---"
    );
    for (const file of plan.files) lines.push(file.path);
    lines.push("--- package dependencies ---");
    for (const [name, spec] of Object.entries(plan.packageDependencies)) {
      lines.push(`${name}: ${spec}`);
    }
    for (const file of plan.files) {
      lines.push(`--- ${file.path} ---`, file.content.trimEnd());
    }
    lines.push("");
  });
  return lines.join("\n");
}

export function assertApplyAllowed(allowlist, { targetsFlag = false } = {}) {
  if (!targetsFlag) {
    throw new Error("Pass --targets <allowlist.json>. --apply does not use the example file.");
  }
  if (path.basename(allowlist.sourceName) === EXAMPLE_FILENAME || allowlist.example) {
    throw new Error(
      "Refusing --apply for the example allowlist. Copy it, set \"example\" to false, and list repositories you maintain."
    );
  }
  if (allowlist.targets.length === 0) {
    throw new Error("Refusing --apply because the allowlist has no targets.");
  }
}

function encodePath(filePath) {
  return filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function readRepoFile(github, repo, filePath, ref) {
  assertSafePath(filePath);
  const data = await github.request(
    "GET",
    `/repos/${repo}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`,
    undefined,
    { allow404: true }
  );
  if (!data) return null;
  if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
    throw new Error(`${filePath} is not a file`);
  }
  return Buffer.from(data.content, data.encoding || "base64").toString("utf8");
}

function assertPublicContent(content) {
  if (content.includes("BEGIN PRIVATE KEY") || content.includes("BEGIN OPENSSH PRIVATE KEY")) {
    throw new Error("Refusing to write private key material");
  }
  if (content.includes("npm install trustflow-sdk")) {
    throw new Error("Refusing to document npm install trustflow-sdk");
  }
}

export async function applyEcosystemPlan(plan, github) {
  const updates = new Map(plan.files.map((file) => [file.path, file.content]));
  for (const filePath of updates.keys()) assertSafePath(filePath);

  for (const filePath of updates.keys()) {
    const existing = await readRepoFile(github, plan.repo, filePath, plan.base);
    if (existing !== null) {
      throw new Error(`${plan.repo} already has ${filePath}. Refusing to overwrite it.`);
    }
  }

  const packageJson = await readRepoFile(github, plan.repo, "package.json", plan.base);
  if (packageJson !== null) {
    const merged = mergePackageDependency(packageJson, plan.packageDependencies);
    if (merged !== null) updates.set("package.json", merged);
  }

  const gitignore = await readRepoFile(github, plan.repo, ".gitignore", plan.base);
  const nextIgnore = ensureGitignore(gitignore);
  if (nextIgnore !== null) updates.set(".gitignore", nextIgnore);

  const tree = [];
  for (const [filePath, content] of updates) {
    assertSafePath(filePath);
    assertPublicContent(content);
    tree.push({ path: filePath, mode: "100644", type: "blob", content });
  }

  const ref = await github.request("GET", `/repos/${plan.repo}/git/ref/heads/${plan.base}`);
  const parentSha = ref.object.sha;
  const parent = await github.request("GET", `/repos/${plan.repo}/git/commits/${parentSha}`);
  const createdTree = await github.request("POST", `/repos/${plan.repo}/git/trees`, {
    base_tree: parent.tree.sha,
    tree,
  });
  const commit = await github.request("POST", `/repos/${plan.repo}/git/commits`, {
    message: plan.commitMessage,
    tree: createdTree.sha,
    parents: [parentSha],
  });
  await github.request("POST", `/repos/${plan.repo}/git/refs`, {
    ref: `refs/heads/${plan.branch}`,
    sha: commit.sha,
  });
  const pull = await github.request("POST", `/repos/${plan.repo}/pulls`, {
    title: plan.title,
    head: plan.branch,
    base: plan.base,
    body: plan.body,
  });
  if (typeof pull.html_url !== "string") throw new Error("GitHub did not return a pull request URL");
  return { url: pull.html_url, number: pull.number };
}
