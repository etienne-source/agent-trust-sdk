import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyEcosystemPlan,
  assertApplyAllowed,
  formatDryRun,
  loadAllowlist,
  planAllowlist,
} from "./lib/ecosystem-prs.mjs";
import { createGithubClient, repoRoot } from "./lib/starter-prs.mjs";

const script = path.join(repoRoot(), "scripts", "submit-ecosystem-prs.mjs");
const examplePath = path.join(repoRoot(), "scripts", "ecosystem-targets.example.json");

function allowlist(targets, name = "ecosystem-targets.json") {
  return loadAllowlist(
    JSON.stringify({
      example: false,
      targets,
    }),
    name
  );
}

function target(overrides = {}) {
  return {
    repo: "acme/agent",
    framework: "langchain",
    enabled: true,
    base: "main",
    ...overrides,
  };
}

test("example allowlist is empty and dry-runs without opening a pull request", () => {
  const parsed = JSON.parse(readFileSync(examplePath, "utf8"));
  assert.equal(parsed.example, true);
  assert.deepEqual(parsed.targets, []);

  const loaded = loadAllowlist(readFileSync(examplePath, "utf8"), examplePath);
  assert.equal(loaded.example, true);
  assert.equal(loaded.targets.length, 0);
  const output = formatDryRun(loaded, planAllowlist(loaded));
  assert.match(output, /mode: dry-run/);
  assert.match(output, /targets: 0/);
  assert.match(output, /does not search GitHub/);
  assert.doesNotMatch(output, /npm install trustflow-sdk/);

  assert.throws(() => assertApplyAllowed(loaded, { targetsFlag: true }), /example allowlist/);
  assert.throws(() => assertApplyAllowed(allowlist([]), { targetsFlag: true }), /no targets/);
  assert.throws(() => assertApplyAllowed(allowlist([target()]), { targetsFlag: false }), /Pass --targets/);
});

test("plans middleware files for agent frameworks", () => {
  const plans = planAllowlist(
    allowlist([
      target(),
      target({ repo: "acme/graph", framework: "langgraph" }),
      target({ repo: "acme/ai", framework: "vercel-ai" }),
      target({ repo: "acme/openai", framework: "openai-agents" }),
      target({ repo: "acme/llama", framework: "llamaindex" }),
    ])
  );
  assert.equal(plans.length, 5);
  const byRepo = Object.fromEntries(plans.map((plan) => [plan.repo, plan]));
  assert.match(byRepo["acme/agent"].files[0].content, /agenticTrustLangChainMiddleware/);
  assert.match(byRepo["acme/graph"].files[0].content, /LangGraph/);
  assert.match(byRepo["acme/ai"].files[0].content, /agenticTrustVercelAiMiddleware/);
  assert.match(byRepo["acme/openai"].files[0].content, /verifyDomain/);
  assert.match(byRepo["acme/llama"].files[0].content, /assertSourceDomain/);
  assert.equal(
    byRepo["acme/ai"].packageDependencies["@agentic-trust/vercel-ai-middleware"],
    "github:etienne-source/agent-trust-sdk#path:/packages/vercel-ai-middleware"
  );
  for (const plan of plans) {
    const blob = `${plan.body}\n${plan.files.map((file) => file.content).join("\n")}`;
    assert.match(blob, /Context Poisoning Defense Triggered/);
    assert.match(blob, /Trustflow Systems/);
    assert.doesNotMatch(blob, /npm install trustflow-sdk/);
    assert.doesNotMatch(blob, /BEGIN PRIVATE KEY/);
    assert.match(plan.body, /does not post to X/);
  }

  const mastra = planAllowlist(allowlist([target({ repo: "acme/mastra", framework: "mastra" })]))[0];
  assert.match(mastra.files[0].content, /Mastra/);
});

test("rejects targets that are not an explicit framework repo", () => {
  assert.throws(() => allowlist([target({ repo: "https://github.com/acme/agent" })]), /owner\/name/);
  assert.throws(() => allowlist([target({ framework: "next" })]), /framework/);
  assert.throws(() => allowlist([target({ enabled: false })]), /enabled/);
  assert.throws(() => allowlist([target(), target()]), /Duplicate repo/);
  const many = Array.from({ length: 6 }, (_, index) => target({ repo: `acme/repo-${index}`, framework: "mastra" }));
  assert.throws(() => allowlist(many), /maximum per run is 5/);
});

test("apply creates one branch and pull request from the allowlist", async () => {
  const [plan] = planAllowlist(allowlist([target({ framework: "vercel-ai", repo: "acme/starter" })]));
  const calls = [];
  const files = new Map([
    ["package.json", '{\n  "name": "starter",\n  "dependencies": {\n    "ai": "^4.0.0"\n  }\n}\n'],
  ]);
  const github = {
    async request(method, requestPath, body) {
      calls.push({ method, requestPath, body });
      if (method === "GET" && requestPath.includes("/contents/")) {
        const relative = decodeURIComponent(requestPath.split("/contents/")[1].split("?")[0]);
        if (!files.has(relative)) return null;
        return {
          type: "file",
          encoding: "base64",
          content: Buffer.from(files.get(relative), "utf8").toString("base64"),
        };
      }
      if (method === "GET" && requestPath.endsWith("/git/ref/heads/main")) return { object: { sha: "parentsha" } };
      if (method === "GET" && requestPath.endsWith("/git/commits/parentsha")) return { tree: { sha: "treesha" } };
      if (method === "POST" && requestPath.endsWith("/git/trees")) return { sha: "newtree" };
      if (method === "POST" && requestPath.endsWith("/git/commits")) return { sha: "newcommit" };
      if (method === "POST" && requestPath.endsWith("/git/refs")) return { ref: body.ref };
      if (method === "POST" && requestPath.endsWith("/pulls")) {
        return { html_url: "https://github.com/acme/starter/pull/3", number: 3 };
      }
      throw new Error(`unexpected ${method} ${requestPath}`);
    },
  };

  const opened = await applyEcosystemPlan(plan, github);
  assert.equal(opened.url, "https://github.com/acme/starter/pull/3");
  assert.equal(calls.some((call) => call.requestPath.includes("/search/")), false);
  const tree = calls.find((call) => call.requestPath.endsWith("/git/trees")).body;
  const paths = tree.tree.map((entry) => entry.path);
  assert.ok(paths.includes("src/agentic-trust-vercel-ai.ts"));
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes(".gitignore"));
  const pkg = tree.tree.find((entry) => entry.path === "package.json").content;
  assert.match(pkg, /@agentic-trust\/sdk/);
  assert.match(pkg, /@agentic-trust\/vercel-ai-middleware/);
  assert.doesNotMatch(pkg, /trustflow-sdk/);
  const pull = calls.find((call) => call.requestPath.endsWith("/pulls")).body;
  assert.equal(pull.head, "agentic-trust/framework-middleware");
  assert.match(pull.body, /does not post to X/);

  files.set("src/agentic-trust-vercel-ai.ts", "export {};\n");
  await assert.rejects(() => applyEcosystemPlan(plan, github), /already has src\/agentic-trust-vercel-ai.ts/);
});

test("github client refuses search and a missing token", async () => {
  assert.throws(() => createGithubClient({ token: "  " }), /GITHUB_TOKEN/);
  const client = createGithubClient({
    token: "test-token",
    fetchImpl: async () => {
      throw new Error("network should not be called");
    },
  });
  await assert.rejects(() => client.request("GET", "/search/repositories"), /search/);
});

test("cli dry-run smoke", () => {
  const dry = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /mode: dry-run/);
  assert.match(dry.stdout, /targets: 0/);

  const directory = mkdtempSync(path.join(tmpdir(), "ecosystem-prs-"));
  const file = path.join(directory, "targets.json");
  writeFileSync(file, JSON.stringify({ example: false, targets: [target({ repo: "acme/dry-run", framework: "mastra" })] }));
  const planned = spawnSync(process.execPath, [script, "--targets", file], { encoding: "utf8" });
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /title: Add AgenticTrust fail-closed middleware/);
  assert.match(planned.stdout, /src\/agentic-trust-mastra.ts/);
  assert.match(planned.stdout, /Dry run only/);
  assert.doesNotMatch(planned.stdout, /npm install trustflow-sdk/);

  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  const applyExample = spawnSync(process.execPath, [script, "--apply", "--targets", examplePath], {
    encoding: "utf8",
    env,
  });
  assert.equal(applyExample.status, 1);
  assert.match(applyExample.stderr, /example allowlist/);

  const applyMissingToken = spawnSync(process.execPath, [script, "--apply", "--targets", file], {
    encoding: "utf8",
    env,
  });
  assert.equal(applyMissingToken.status, 1);
  assert.match(applyMissingToken.stderr, /GITHUB_TOKEN/);
});
