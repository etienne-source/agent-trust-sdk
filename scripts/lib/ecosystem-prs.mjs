import path from "node:path";
import { Octokit } from "@octokit/rest";
import {
  createGithubClient,
  ensureGitignore,
  loadStarterTemplates,
  mergePackageDependency,
  placeholderDid,
  renderLlms,
} from "./starter-prs.mjs";

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
  "[Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for ${domain}. Execution blocked.";

function installComment(specs) {
  return [
    " * Install from GitHub until the npm scope exists:",
    ` *   pnpm add ${specs.join(" ")}`,
    " * Do not install the unrelated trustflow-sdk package.",
    " * Protocol: Trustflow. Registry: Trustflow Systems (https://trustflow.systems).",
  ].join("\n");
}

function securityThrow() {
  return `throw new Error(\`${SECURITY_ERROR}\`);`;
}

function langchainFile() {
  return `import { agenticTrustLangChainMiddleware } from "@trustflow/langchain-middleware";

/**
 * Trustflow middleware for LangChain.js. Audit mode is the default.
 * Set strict: true to throw before unsigned or tampered llms.txt is parsed.
${installComment([SDK_SPEC, LANGCHAIN_SPEC])}
 */
export const agenticTrust = agenticTrustLangChainMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

function langgraphFile() {
  return `import { agenticTrustLangChainMiddleware } from "@trustflow/langchain-middleware";

/**
 * Trustflow middleware for LangGraph. Audit mode is the default.
 * Pass \`agenticTrust\` to \`createMiddleware\` on the graph. Set strict: true
 * to stop execution when llms.txt context is unverified or tampered.
${installComment([SDK_SPEC, LANGCHAIN_SPEC])}
 */
export const agenticTrust = agenticTrustLangChainMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

function vercelAiFile() {
  return `import { agenticTrustVercelAiMiddleware } from "@trustflow/vercel-ai-middleware";

/**
 * Trustflow middleware for the Vercel AI SDK. Audit mode is the default.
 * Pass \`fetch\` to the provider and this object to \`wrapLanguageModel\`.
 * Set strict: true to block unsigned context.
${installComment([SDK_SPEC, VERCEL_AI_SPEC])}
 */
export const agenticTrust = agenticTrustVercelAiMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});
`;
}

function openaiFile() {
  return `import { verifyDomain } from "@trustflow/sdk";

/**
 * Trustflow check for OpenAI Agents tool URLs.
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
  return `import { verifyDomain } from "@trustflow/sdk";

/**
 * Trustflow check for LlamaIndex source domains.
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
  return `import { agenticTrustVercelAiMiddleware } from "@trustflow/vercel-ai-middleware";

/**
 * Trustflow middleware for Mastra agents that use the Vercel AI SDK.
 * Audit mode is the default. Pass \`fetch\` to the model provider and this object
 * to \`wrapLanguageModel\`. Set strict: true to block unsigned context.
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
  return { "@trustflow/sdk": SDK_SPEC };
}

function sdkAnd(spec) {
  const name = spec.includes("langchain")
    ? "@trustflow/langchain-middleware"
    : "@trustflow/vercel-ai-middleware";
  return { "@trustflow/sdk": SDK_SPEC, [name]: spec };
}

const ALLOWED_EXACT = new Set([
  "package.json",
  ".gitignore",
  "llms.txt",
  ".well-known/llms.txt",
  ".well-known/did.json",
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

function assertDomain(value, index) {
  const domain = String(value ?? "REPLACE_ME.example").trim().toLowerCase();
  if (domain === "replace_me.example") return "REPLACE_ME.example";
  if (
    !/^[a-z0-9.-]+$/.test(domain) ||
    domain.length > 253 ||
    !domain.includes(".") ||
    domain.includes("..") ||
    domain.startsWith("-") ||
    domain.endsWith(".") ||
    domain.startsWith(".")
  ) {
    throw new Error(`targets[${index}].domain is not a hostname`);
  }
  return domain;
}

function assertShort(value, index, field, max) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`targets[${index}].${field} must be a string`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`targets[${index}].${field} must be 1-${max} characters`);
  return text;
}

function assertServices(value, index) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error(`targets[${index}].services must be an array of at most 20 strings`);
  }
  return value.map((item, serviceIndex) => {
    if (typeof item !== "string" || !item.trim() || item.length > 80) {
      throw new Error(`targets[${index}].services[${serviceIndex}] must be a short string`);
    }
    return item.trim();
  });
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
    domain: assertDomain(entry.domain, index),
    name: assertShort(entry.name, index, "name", 80),
    description: assertShort(entry.description, index, "description", 200),
    services: assertServices(entry.services, index),
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
    "## Executive summary: context-poisoning defense",
    "",
    "Agents often read domain context (`llms.txt` and similar host-served instructions) before they answer.",
    "If that hostname has no `did:web` signature, nothing binds those bytes to a key the agent trusts.",
    "A later edit that breaks an Ed25519 or P-256 JWS is the same class of failure: the text is no longer authenticated.",
    "Context signing is the TLS check for that fetch. Verify the domain, then parse the file.",
    "",
    `This pull request adds **Trustflow** wiring for a ${target.framework} starter.`,
    "The hosted registry is **Trustflow Systems** (https://trustflow.systems).",
    "The middleware defaults to audit mode. Unsigned context logs `[Trustflow Security Alert] Unverified context payload detected for <domain>. Enable strict mode to block.` and is not parsed.",
    "Set `{ strict: true }` to fail closed. Strict mode throws:",
    "",
    "```text",
    "[Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.",
    "```",
    "",
    "`.well-known/did.json` and `llms.txt` in this change are unsigned placeholders (`proof.jws` is `REPLACE_ME`).",
    `They do not make \`${target.domain}\` VERIFIED.`,
    "Replace them with `npx @trustflow/cli@latest init`. Do not commit a private key or `.agentic-trust/`.",
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

export function planTarget(target, templates = loadStarterTemplates()) {
  const spec = FRAMEWORK_FILES[target.framework];
  const content = spec.content();
  if (content.includes("BEGIN PRIVATE KEY") || content.includes("npm install trustflow-sdk")) {
    throw new Error(`Refusing to plan ${target.framework}: unsafe snippet`);
  }
  const llms = renderLlms({
    name: target.name ?? `Trustflow ${target.framework} starter`,
    description:
      target.description ?? "Placeholder did:web identity. Replace REPLACE_ME before you publish the site.",
    domain: target.domain,
    services: target.services ?? [],
  });
  const did = placeholderDid(templates.did, target.domain);
  const files = [
    { path: spec.path, content },
    { path: "llms.txt", content: llms },
    { path: ".well-known/llms.txt", content: llms },
    { path: ".well-known/did.json", content: did },
  ];
  for (const file of files) {
    assertSafePath(file.path);
    assertPublicContent(file.content);
  }
  if (!did.includes('"jws": "REPLACE_ME"')) {
    throw new Error("Refusing to plan a did.json that is not the REPLACE_ME placeholder");
  }
  return {
    repo: target.repo,
    framework: target.framework,
    base: target.base,
    domain: target.domain,
    branch: ECOSYSTEM_BRANCH,
    title: "Add Trustflow fail-closed middleware",
    body: pullRequestBody(target),
    commitMessage:
      "Add Trustflow fail-closed domain middleware\n\nPlaceholder did:web and llms.txt only. proof.jws stays REPLACE_ME. Does not add a private key.",
    files,
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
      "--live and --apply are refused without an explicit non-example targets file. This command does not search GitHub.",
      ""
    );
    return lines.join("\n");
  }
  lines.push(
    "Dry run only. Pass --live (or --apply) and --targets <allowlist.json> to fork (or update an existing fork) and open these pull requests.",
    "--live requires GITHUB_TOKEN or GH_TOKEN. Without --targets, --live is refused. This command does not search GitHub.",
    ""
  );
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

export function assertApplyAllowed(allowlist, { targetsFlag = false, mode = "apply" } = {}) {
  const flag = mode === "live" ? "--live" : "--apply";
  if (!targetsFlag) {
    throw new Error(`Pass --targets <allowlist.json>. ${flag} does not use the example file and does not search GitHub.`);
  }
  if (path.basename(allowlist.sourceName) === EXAMPLE_FILENAME || allowlist.example) {
    throw new Error(
      `Refusing ${flag} for the example allowlist. Copy it, set "example" to false, and list repositories you maintain.`
    );
  }
  if (allowlist.targets.length === 0) {
    throw new Error(`Refusing ${flag} because the allowlist has no targets.`);
  }
}

function assertPublicContent(content) {
  if (content.includes("BEGIN PRIVATE KEY") || content.includes("BEGIN OPENSSH PRIVATE KEY")) {
    throw new Error("Refusing to write private key material");
  }
  if (content.includes("npm install trustflow-sdk")) {
    throw new Error("Refusing to document npm install trustflow-sdk");
  }
}

const SEARCH_REFUSAL = "Refusing a GitHub search request. Targets come only from the allowlist.";

function statusOf(error) {
  return error && typeof error === "object" && "status" in error ? error.status : undefined;
}

export function sealOctokit(octokit) {
  if (!octokit || typeof octokit !== "object") {
    throw new Error("applyEcosystemPlan requires an Octokit client.");
  }
  const search = octokit.rest?.search;
  if (search && typeof search === "object") {
    for (const key of Object.keys(search)) {
      if (typeof search[key] !== "function") continue;
      const sealed = async () => {
        throw new Error(SEARCH_REFUSAL);
      };
      search[key] = sealed;
    }
  }
  if (typeof octokit.request === "function" && !octokit.request.__agenticTrustSealed) {
    const original = octokit.request.bind(octokit);
    const wrapped = async (route, options) => {
      const text = `${typeof route === "string" ? route : ""} ${options?.url ?? ""}`;
      if (text.includes("/search/")) throw new Error(SEARCH_REFUSAL);
      return original(route, options);
    };
    wrapped.__agenticTrustSealed = true;
    octokit.request = wrapped;
  }
  return octokit;
}

export function createOctokitClient({ token, OctokitImpl = Octokit, mode = "apply" } = {}) {
  const flag = mode === "live" ? "--live" : "--apply";
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (!trimmed) throw new Error(`GITHUB_TOKEN or GH_TOKEN is required for ${flag}.`);
  const octokit = new OctokitImpl({
    auth: trimmed,
    userAgent: "agentic-trust-ecosystem-prs",
  });
  return sealOctokit(octokit);
}

function splitRepo(repo) {
  const [owner, name] = String(repo).split("/");
  if (!owner || !name) throw new Error(`repo must be owner/name`);
  return { owner, name };
}

async function readRepoFile(octokit, owner, repo, filePath, ref) {
  assertSafePath(filePath);
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref });
    if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
      throw new Error(`${filePath} is not a file`);
    }
    return Buffer.from(data.content, data.encoding || "base64").toString("utf8");
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

async function waitForFork(octokit, owner, repo, { attempts = 5, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return data;
    } catch (error) {
      last = error;
      if (statusOf(error) !== 404) throw error;
      if (attempt < attempts - 1) await sleep(25 * (attempt + 1));
    }
  }
  throw new Error(`Fork ${owner}/${repo} was not ready (${last instanceof Error ? last.message : "unknown"}).`);
}

async function ensureFork(octokit, { login, upstreamOwner, upstreamRepo }) {
  if (login === upstreamOwner) {
    return { owner: upstreamOwner, repo: upstreamRepo, created: false };
  }
  try {
    const { data } = await octokit.rest.repos.get({ owner: login, repo: upstreamRepo });
    const parent = data.parent?.full_name;
    if (data.fork === true && parent === `${upstreamOwner}/${upstreamRepo}`) {
      return { owner: login, repo: upstreamRepo, created: false };
    }
    throw new Error(
      `Refusing to push to ${login}/${upstreamRepo}; it is not a fork of ${upstreamOwner}/${upstreamRepo}.`
    );
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }
  const { data } = await octokit.rest.repos.createFork({ owner: upstreamOwner, repo: upstreamRepo });
  await waitForFork(octokit, data.owner?.login || login, data.name || upstreamRepo);
  return { owner: data.owner?.login || login, repo: data.name || upstreamRepo, created: true };
}

async function resolveParentSha(octokit, { destination, upstreamOwner, upstreamRepo, base }) {
  const upstream = await octokit.rest.git.getRef({
    owner: upstreamOwner,
    repo: upstreamRepo,
    ref: `heads/${base}`,
  });
  const sha = upstream.data.object.sha;
  if (destination.owner === upstreamOwner && destination.repo === upstreamRepo) return sha;
  try {
    await octokit.rest.git.getCommit({
      owner: destination.owner,
      repo: destination.repo,
      commit_sha: sha,
    });
    return sha;
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    if (typeof octokit.rest.repos.mergeUpstream !== "function") {
      throw new Error(`Fork ${destination.owner}/${destination.repo} is missing ${sha} and cannot sync.`);
    }
    await octokit.rest.repos.mergeUpstream({
      owner: destination.owner,
      repo: destination.repo,
      branch: base,
    });
    const synced = await octokit.rest.git.getRef({
      owner: destination.owner,
      repo: destination.repo,
      ref: `heads/${base}`,
    });
    return synced.data.object.sha;
  }
}

async function pushBranch(octokit, destination, branch, sha) {
  try {
    await octokit.rest.git.createRef({
      owner: destination.owner,
      repo: destination.repo,
      ref: `refs/heads/${branch}`,
      sha,
    });
  } catch (error) {
    if (statusOf(error) !== 422) throw error;
    await octokit.rest.git.updateRef({
      owner: destination.owner,
      repo: destination.repo,
      ref: `heads/${branch}`,
      sha,
      force: false,
    });
  }
}

export async function applyEcosystemPlan(plan, octokit) {
  if (!octokit?.rest?.repos || !octokit?.rest?.git || !octokit?.rest?.pulls || !octokit?.rest?.users) {
    throw new Error("applyEcosystemPlan requires an Octokit client.");
  }
  sealOctokit(octokit);

  const { owner: upstreamOwner, name: upstreamRepo } = splitRepo(plan.repo);
  const { data: me } = await octokit.rest.users.getAuthenticated();
  const login = me?.login;
  if (typeof login !== "string" || !login) throw new Error("GitHub did not return the authenticated user.");
  const destination = await ensureFork(octokit, { login, upstreamOwner, upstreamRepo });

  const updates = new Map(plan.files.map((file) => [file.path, file.content]));
  for (const filePath of updates.keys()) assertSafePath(filePath);

  for (const filePath of updates.keys()) {
    const existing = await readRepoFile(octokit, upstreamOwner, upstreamRepo, filePath, plan.base);
    if (existing !== null) {
      throw new Error(`${plan.repo} already has ${filePath}. Refusing to overwrite it.`);
    }
  }

  const packageJson = await readRepoFile(octokit, upstreamOwner, upstreamRepo, "package.json", plan.base);
  if (packageJson !== null) {
    const merged = mergePackageDependency(packageJson, plan.packageDependencies);
    if (merged !== null) updates.set("package.json", merged);
  }

  const gitignore = await readRepoFile(octokit, upstreamOwner, upstreamRepo, ".gitignore", plan.base);
  const nextIgnore = ensureGitignore(gitignore);
  if (nextIgnore !== null) updates.set(".gitignore", nextIgnore);

  const tree = [];
  for (const [filePath, content] of updates) {
    assertSafePath(filePath);
    assertPublicContent(content);
    tree.push({ path: filePath, mode: "100644", type: "blob", content });
  }

  const parentSha = await resolveParentSha(octokit, {
    destination,
    upstreamOwner,
    upstreamRepo,
    base: plan.base,
  });
  const { data: parent } = await octokit.rest.git.getCommit({
    owner: destination.owner,
    repo: destination.repo,
    commit_sha: parentSha,
  });
  const { data: createdTree } = await octokit.rest.git.createTree({
    owner: destination.owner,
    repo: destination.repo,
    base_tree: parent.tree.sha,
    tree,
  });
  const { data: commit } = await octokit.rest.git.createCommit({
    owner: destination.owner,
    repo: destination.repo,
    message: plan.commitMessage,
    tree: createdTree.sha,
    parents: [parentSha],
  });
  await pushBranch(octokit, destination, plan.branch, commit.sha);

  const head = destination.owner === upstreamOwner ? plan.branch : `${destination.owner}:${plan.branch}`;
  const { data: pull } = await octokit.rest.pulls.create({
    owner: upstreamOwner,
    repo: upstreamRepo,
    title: plan.title,
    head,
    base: plan.base,
    body: plan.body,
  });
  if (typeof pull.html_url !== "string") throw new Error("GitHub did not return a pull request URL");
  return {
    url: pull.html_url,
    number: pull.number,
    head,
    fork: `${destination.owner}/${destination.repo}`,
    createdFork: destination.created,
  };
}
