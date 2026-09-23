import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_TARGETS = 5;
export const STARTER_BRANCH = "agentic-trust/starter-identity";
export const EXAMPLE_FILENAME = "starter-pr-targets.example.json";

const NEXT_PLUGIN_SPEC = "github:etienne-source/agent-trust-sdk#path:/packages/next-plugin";
const SDK_SPEC = "github:etienne-source/agent-trust-sdk#path:/packages/sdk";
const LANGCHAIN_SPEC = "github:etienne-source/agent-trust-sdk#path:/packages/langchain-middleware";

const NEXT_CONFIGS = {
  ts: ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"],
  mjs: ["next.config.mjs", "next.config.js", "next.config.ts", "next.config.mts", "next.config.cjs"],
  js: ["next.config.js", "next.config.cjs", "next.config.mjs", "next.config.ts", "next.config.mts"],
};

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function loadStarterTemplates(root = repoRoot()) {
  const starter = (name, relative) => readFileSync(path.join(root, "starters", name, relative), "utf8");
  return {
    did: starter("nextjs", "public/.well-known/did.json"),
    cursorrules: starter("nextjs", ".cursorrules"),
    mdc: starter("nextjs", ".cursor/rules/agentic-trust.mdc"),
    snippets: {
      ts: starter("nextjs", "next.config.ts"),
      mjs: starter("v0", "next.config.mjs"),
      js: starter("bolt", "next.config.js"),
    },
  };
}

function assertRepo(value, index) {
  const repo = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`targets[${index}].repo must be owner/name`);
  }
  return repo;
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
  const framework = entry.framework;
  if (framework !== "next" && framework !== "langchain") {
    throw new Error(`targets[${index}].framework must be "next" or "langchain"`);
  }
  let nextConfig = "ts";
  if (framework === "next" && entry.nextConfig !== undefined) {
    if (entry.nextConfig !== "ts" && entry.nextConfig !== "mjs" && entry.nextConfig !== "js") {
      throw new Error(`targets[${index}].nextConfig must be ts, mjs, or js`);
    }
    nextConfig = entry.nextConfig;
  }
  return {
    repo: assertRepo(entry.repo, index),
    framework,
    nextConfig,
    domain: assertDomain(entry.domain, index),
    name: assertShort(entry.name, index, "name", 80),
    description: assertShort(entry.description, index, "description", 200),
    services: assertServices(entry.services, index),
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

export function renderLlms({ name, description, domain, services }) {
  const lines = [`# ${name}`, `> ${description}`, "", `Domain: ${domain}`, ""];
  if (services.length > 0) {
    lines.push("## Services", ...services.map((service) => `- ${service}`), "");
  }
  lines.push(
    "## Identity",
    `- DID: did:web:${domain}`,
    `- Manifest: https://${domain}/.well-known/did.json`,
    "",
    "## Trust",
    "Verified by AgenticTrust. Registry: Trustflow Systems (https://trustflow.systems).",
    "Agents should call verifyDomain before tool invocation.",
    ""
  );
  return lines.join("\n");
}

export function placeholderDid(template, domain) {
  const replaced = template.replaceAll("REPLACE_ME.example", domain);
  const doc = JSON.parse(replaced);
  if (doc?.proof?.jws !== "REPLACE_ME" || doc?.verificationMethod?.[0]?.publicKeyPem !== "REPLACE_ME") {
    throw new Error("Refusing to emit a did.json that is not the REPLACE_ME placeholder");
  }
  if (JSON.stringify(doc).includes("BEGIN PRIVATE KEY")) {
    throw new Error("Refusing to emit private key material");
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function adaptRules(text, framework) {
  if (framework === "next") return text;
  const rewritten = text
    .replaceAll("public/.well-known/did.json", ".well-known/did.json")
    .replaceAll("public/.well-known/llms.txt", ".well-known/llms.txt")
    .replaceAll("public/llms.txt", "llms.txt")
    .replace(
      "This project uses the AgenticTrust default public folder `public/`.",
      "This project keeps AgenticTrust identity files at the repository root."
    );
  return rewritten;
}

function langchainWiring(domain) {
  return `import { agenticTrustLangChainMiddleware } from "@trustflow/langchain-middleware";

/**
 * AgenticTrust middleware for LangChain.js. Pass it to \`createMiddleware\`.
 * Unsigned llms.txt throws before it is parsed.
 * Protocol: AgenticTrust. Registry: Trustflow Systems (https://trustflow.systems).
 *
 * Packages: @trustflow/langchain-middleware and @trustflow/sdk.
 * Install from GitHub until the npm scope exists:
 *   pnpm add ${SDK_SPEC} ${LANGCHAIN_SPEC}
 *
 * Do not install the unrelated trustflow-sdk package.
 * Domain placeholder: ${domain}
 */
export const agenticTrust = agenticTrustLangChainMiddleware({
  verificationApiUrl: process.env.AGENTIC_TRUST_API_URL ?? "https://api.trustflow.systems",
});

export const agenticTrustDomain = ${JSON.stringify(domain)};
`;
}

function pullRequestBody(target) {
  const install =
    target.framework === "next"
      ? `pnpm add ${NEXT_PLUGIN_SPEC}`
      : `pnpm add ${SDK_SPEC} ${LANGCHAIN_SPEC}`;
  const wiring =
    target.framework === "next"
      ? [
          "Wrap the existing Next.js config with `withAgenticTrust` from `@trustflow/next-plugin`, and set `turbopack: {}` so Next.js 16 accepts the plugin's development webpack hook.",
          "The snippet matches `starters/nextjs`, `starters/v0`, or `starters/bolt` in `etienne-source/agent-trust-sdk`. Merge that wrapper into the config that is already here. Do not replace the application.",
          "On `--apply`, a simple `export default <name>` or `module.exports = <name>` is wrapped in place when that file already exists.",
        ].join(" ")
      : "`src/agentic-trust.ts` exports `agenticTrustLangChainMiddleware()` from `@trustflow/langchain-middleware`. Pass it to LangChain `createMiddleware`. It throws before parsing unsigned `llms.txt`.";

  return [
    "## AgenticTrust identity placeholder",
    "",
    "Adds a placeholder `did:web` document, `llms.txt`, and wiring for **AgenticTrust**.",
    "The hosted registry is **Trustflow Systems** (https://trustflow.systems).",
    "",
    `\`did.json\` is the unsigned starter placeholder (\`proof.jws\` is \`REPLACE_ME\`). It does not make \`${target.domain}\` VERIFIED.`,
    "Replace it with `npx trustflow init` from `@trustflow/cli` (clone `github:etienne-source/agent-trust-sdk` until the npm scope exists).",
    "For Next.js, copy the signed document to `public/.well-known/did.json`. Do not commit a private key or `.agentic-trust/`.",
    "",
    "### Install",
    "",
    "```bash",
    install,
    "```",
    "",
    "Do not install the unrelated `trustflow-sdk` package.",
    "",
    "### Wiring",
    "",
    wiring,
    "",
    "Sharing a verification result on X is a separate explicit step. This change does not post to X.",
    "",
  ].join("\n");
}

export function planTarget(target, templates = loadStarterTemplates()) {
  const name =
    target.name ??
    (target.framework === "langchain" ? "AgenticTrust LangChain starter" : "AgenticTrust starter");
  const description =
    target.description ?? "Placeholder did:web identity. Replace REPLACE_ME before you publish the site.";
  const llms = renderLlms({
    name,
    description,
    domain: target.domain,
    services: target.services,
  });
  const did = placeholderDid(templates.did, target.domain);
  const rules = adaptRules(templates.cursorrules, target.framework);
  const mdc = adaptRules(templates.mdc, target.framework);
  const files = [];

  if (target.framework === "next") {
    files.push(
      { path: "public/llms.txt", content: llms },
      { path: "public/.well-known/llms.txt", content: llms },
      { path: "public/.well-known/did.json", content: did },
      { path: ".cursorrules", content: rules },
      { path: ".cursor/rules/agentic-trust.mdc", content: mdc },
      {
        path: `agentic-trust/next.config.snippet.${target.nextConfig === "ts" ? "ts" : target.nextConfig}`,
        content: templates.snippets[target.nextConfig],
      }
    );
  } else {
    files.push(
      { path: "llms.txt", content: llms },
      { path: ".well-known/llms.txt", content: llms },
      { path: ".well-known/did.json", content: did },
      { path: ".cursorrules", content: rules },
      { path: ".cursor/rules/agentic-trust.mdc", content: mdc },
      { path: "src/agentic-trust.ts", content: langchainWiring(target.domain) }
    );
  }

  for (const file of files) assertSafePath(file.path);

  const snippet = files.find((file) => file.path.startsWith("agentic-trust/next.config.snippet."));
  return {
    repo: target.repo,
    framework: target.framework,
    base: target.base,
    branch: STARTER_BRANCH,
    title: "Add AgenticTrust placeholder did:web identity",
    body: pullRequestBody(target),
    commitMessage:
      "Add AgenticTrust placeholder identity files\n\nPlaceholder did:web and llms.txt only. proof.jws stays REPLACE_ME.",
    files,
    snippetPath: snippet?.path ?? null,
    packageDependencies:
      target.framework === "next"
        ? { "@trustflow/next-plugin": NEXT_PLUGIN_SPEC }
        : {
            "@trustflow/sdk": SDK_SPEC,
            "@trustflow/langchain-middleware": LANGCHAIN_SPEC,
          },
    nextConfigCandidates: target.framework === "next" ? NEXT_CONFIGS[target.nextConfig] : [],
  };
}

export function planAllowlist(allowlist, templates = loadStarterTemplates()) {
  return allowlist.targets.map((target) => planTarget(target, templates));
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
      "No repositories are allowlisted. Copy scripts/starter-pr-targets.example.json to scripts/starter-pr-targets.json, set \"example\" to false, and add only repositories you maintain.",
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
    for (const file of plan.files) {
      lines.push(file.path);
    }
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

const ALLOWED_EXACT = new Set([
  "llms.txt",
  ".cursorrules",
  ".gitignore",
  "package.json",
  "next.config.ts",
  "next.config.mts",
  "next.config.mjs",
  "next.config.js",
  "next.config.cjs",
  "src/agentic-trust.ts",
  ".cursor/rules/agentic-trust.mdc",
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
  if (filePath === "public/llms.txt" || filePath.startsWith("public/.well-known/")) return filePath;
  if (filePath.startsWith(".well-known/")) return filePath;
  if (filePath.startsWith("agentic-trust/") && !filePath.slice("agentic-trust/".length).includes("/")) {
    return filePath;
  }
  throw new Error(`Refusing to write ${filePath}`);
}

function assertPlaceholderContent(content) {
  if (content.includes("BEGIN PRIVATE KEY") || content.includes("BEGIN OPENSSH PRIVATE KEY")) {
    throw new Error("Refusing to write private key material");
  }
}

export function wrapNextConfig(source, filename) {
  if (source.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Refusing to wrap a next config that contains a private key");
  }
  if (source.includes("withAgenticTrust")) {
    return { wrapped: false, reason: "already-wrapped", content: source };
  }
  const cjs = filename.endsWith(".js") || filename.endsWith(".cjs");
  let content = source.replace(/\r\n/g, "\n");
  const matched = cjs
    ? content.match(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m)
    : content.match(/export default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m);
  if (!matched) return { wrapped: false, reason: "unrecognized-export", content: source };
  const name = matched[1];
  if (cjs) {
    content = `const { withAgenticTrust } = require("@trustflow/next-plugin");\n${content}`;
    content = content.replace(
      new RegExp(`module\\.exports\\s*=\\s*${name}\\s*;?\\s*$`),
      `module.exports = withAgenticTrust(${name});\n`
    );
  } else {
    content = `import { withAgenticTrust } from "@trustflow/next-plugin";\n${content}`;
    content = content.replace(
      new RegExp(`export default\\s+${name}\\s*;?\\s*$`),
      `export default withAgenticTrust(${name});\n`
    );
  }
  if (!/turbopack\s*:/.test(content)) {
    const opened = content.match(new RegExp(`((?:const|let|var)\\s+${name}\\s*=\\s*\\{)`));
    if (opened) {
      content = content.replace(opened[1], `${opened[1]}\n  turbopack: {},`);
    }
  }
  return { wrapped: true, reason: "wrapped", content };
}

export function mergePackageDependency(source, dependencies) {
  const pkg = JSON.parse(source);
  const current =
    pkg.dependencies && typeof pkg.dependencies === "object" && !Array.isArray(pkg.dependencies)
      ? pkg.dependencies
      : {};
  const additions = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    if (Object.prototype.hasOwnProperty.call(current, name)) {
      if (current[name] !== spec) throw new Error(`${name} is already set to ${current[name]}`);
      continue;
    }
    additions.push([name, spec]);
  }
  if (additions.length === 0) return null;
  const entry = additions
    .map(([name, spec]) => `    ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
    .join(",\n");
  if (!/"dependencies"\s*:/.test(source)) {
    const index = source.lastIndexOf("}");
    if (index < 0) throw new Error("package.json has no closing brace");
    const before = source.slice(0, index).replace(/\s*$/, "");
    const comma = before.trim().endsWith("{") ? "" : ",";
    return `${before}${comma}\n  "dependencies": {\n${entry}\n  }\n}\n`;
  }
  const match = source.match(/"dependencies"\s*:\s*\{/);
  if (!match || match.index === undefined) throw new Error("dependencies block not found");
  const insertAt = match.index + match[0].length;
  const after = source.slice(insertAt);
  const comma = after.trimStart().startsWith("}") ? "" : ",";
  return `${source.slice(0, insertAt)}\n${entry}${comma}${after}`;
}

export function ensureGitignore(existing) {
  const required = [".agentic-trust/", "*.pem"];
  const text = existing ?? "";
  const present = new Set(text.split(/\r?\n/));
  const missing = required.filter((line) => !present.has(line));
  if (existing !== null && missing.length === 0) return null;
  const base = existing === null ? "" : text.endsWith("\n") || text === "" ? text : `${text}\n`;
  const header = existing === null ? "# AgenticTrust local secrets\n" : "";
  return `${base}${header}${missing.join("\n")}\n`;
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

export async function applyStarterPlan(plan, github) {
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

  if (plan.framework === "next" && plan.snippetPath) {
    let wrapped = false;
    for (const candidate of plan.nextConfigCandidates) {
      const current = await readRepoFile(github, plan.repo, candidate, plan.base);
      if (current === null) continue;
      const result = wrapNextConfig(current, candidate);
      if (result.wrapped) updates.set(candidate, result.content);
      if (result.wrapped || result.reason === "already-wrapped") {
        updates.delete(plan.snippetPath);
        wrapped = true;
      }
      break;
    }
    if (!wrapped && !updates.has(plan.snippetPath)) {
      throw new Error(`${plan.repo} is missing the Next.js config snippet`);
    }
  }

  const gitignore = await readRepoFile(github, plan.repo, ".gitignore", plan.base);
  const nextIgnore = ensureGitignore(gitignore);
  if (nextIgnore !== null) updates.set(".gitignore", nextIgnore);

  const tree = [];
  for (const [filePath, content] of updates) {
    assertSafePath(filePath);
    assertPlaceholderContent(content);
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

export function createGithubClient({ token, fetchImpl = globalThis.fetch, apiBase = "https://api.github.com" }) {
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (!trimmed) throw new Error("GITHUB_TOKEN or GH_TOKEN is required for --apply.");
  return {
    async request(method, requestPath, body, { allow404 = false } = {}) {
      if (requestPath.includes("/search/")) {
        throw new Error("Refusing a GitHub search request. Targets come only from the allowlist.");
      }
      const response = await fetchImpl(`${apiBase}${requestPath}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${trimmed}`,
          "content-type": "application/json",
          "user-agent": "agentic-trust-starter-prs",
          "x-github-api-version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json = {};
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { message: text.slice(0, 200) };
        }
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        const message = typeof json.message === "string" ? json.message : response.statusText;
        throw new Error(`GitHub ${method} ${requestPath} failed (${response.status}): ${message}`);
      }
      return json;
    },
  };
}
