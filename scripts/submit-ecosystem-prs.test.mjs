import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyEcosystemPlan,
  assertApplyAllowed,
  createOctokitClient,
  formatDryRun,
  loadAllowlist,
  planAllowlist,
} from "./lib/ecosystem-prs.mjs";
import { run } from "./submit-ecosystem-prs.mjs";
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
    assert.match(plan.body, /Executive summary: context-poisoning defense/);
    assert.match(blob, /Context Poisoning Defense Triggered/);
    assert.match(blob, /Trustflow Systems/);
    assert.doesNotMatch(blob, /npm install trustflow-sdk/);
    assert.doesNotMatch(blob, /BEGIN PRIVATE KEY/);
    assert.match(plan.body, /does not post to X/);
    const byPath = Object.fromEntries(plan.files.map((file) => [file.path, file.content]));
    assert.match(byPath["llms.txt"], /did:web:REPLACE_ME\.example/);
    assert.match(byPath[".well-known/llms.txt"], /Trustflow Systems/);
    assert.match(byPath[".well-known/did.json"], /"jws": "REPLACE_ME"/);
    assert.match(byPath[".well-known/did.json"], /"publicKeyPem": "REPLACE_ME"/);
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

function notFound() {
  const error = new Error("Not Found");
  error.status = 404;
  return error;
}

function mockOctokit({ login = "maintainer", fork = "missing", files = new Map(), parentSha = "parentsha" } = {}) {
  const calls = [];
  const state = { forkReady: fork === "existing", synced: false, parentSha, files };
  const record = (name, args) => {
    calls.push({ name, args });
    return args;
  };
  const octokit = {
    rest: {
      users: {
        async getAuthenticated() {
          record("users.getAuthenticated", {});
          return { data: { login } };
        },
      },
      search: {
        async repos() {
          record("search.repos", {});
          return { data: { items: [{ full_name: "unlisted/repo" }] } };
        },
      },
      repos: {
        async get({ owner, repo }) {
          record("repos.get", { owner, repo });
          if (owner === login && repo === "starter" && state.forkReady) {
            return {
              data: {
                fork: login !== "acme",
                name: repo,
                owner: { login },
                parent: { full_name: "acme/starter" },
              },
            };
          }
          if (owner === "other" && repo === "starter") {
            return { data: { fork: false, name: repo, owner: { login: "other" } } };
          }
          throw notFound();
        },
        async createFork({ owner, repo }) {
          record("repos.createFork", { owner, repo });
          state.forkReady = true;
          return { data: { name: repo, owner: { login } } };
        },
        async getContent({ owner, repo, path: filePath, ref }) {
          record("repos.getContent", { owner, repo, path: filePath, ref });
          if (!state.files.has(filePath)) throw notFound();
          return {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(state.files.get(filePath), "utf8").toString("base64"),
            },
          };
        },
        async mergeUpstream({ owner, repo, branch }) {
          record("repos.mergeUpstream", { owner, repo, branch });
          state.synced = true;
          state.parentSha = "syncedsha";
          return { data: { merge_type: "fast-forward" } };
        },
      },
      git: {
        async getRef({ owner, repo, ref }) {
          record("git.getRef", { owner, repo, ref });
          return { data: { object: { sha: state.parentSha } } };
        },
        async getCommit({ owner, repo, commit_sha: commitSha }) {
          record("git.getCommit", { owner, repo, commit_sha: commitSha });
          if (state.missingOnFork && owner === login && !state.synced) throw notFound();
          return { data: { sha: commitSha, tree: { sha: "treesha" } } };
        },
        async createTree({ owner, repo, tree, base_tree: baseTree }) {
          record("git.createTree", { owner, repo, tree, base_tree: baseTree });
          state.tree = tree;
          return { data: { sha: "newtree" } };
        },
        async createCommit(args) {
          record("git.createCommit", args);
          return { data: { sha: "newcommit" } };
        },
        async createRef(args) {
          record("git.createRef", args);
          if (state.refExists) {
            const error = new Error("Reference already exists");
            error.status = 422;
            throw error;
          }
          return { data: { ref: args.ref, object: { sha: args.sha } } };
        },
        async updateRef(args) {
          record("git.updateRef", args);
          return { data: { ref: `refs/${args.ref}`, object: { sha: args.sha } } };
        },
      },
      pulls: {
        async create(args) {
          record("pulls.create", args);
          return { data: { html_url: "https://github.com/acme/starter/pull/3", number: 3 } };
        },
      },
    },
  };
  return { octokit, calls, state };
}

test("apply forks with Octokit, then opens one pull request", async () => {
  const [plan] = planAllowlist(allowlist([target({ framework: "vercel-ai", repo: "acme/starter" })]));
  const { octokit, calls, state } = mockOctokit({
    files: new Map([["package.json", '{\n  "name": "starter",\n  "dependencies": {\n    "ai": "^4.0.0"\n  }\n}\n']]),
  });

  const opened = await applyEcosystemPlan(plan, octokit);
  assert.equal(opened.url, "https://github.com/acme/starter/pull/3");
  assert.equal(opened.fork, "maintainer/starter");
  assert.equal(opened.createdFork, true);
  assert.equal(opened.head, "maintainer:agentic-trust/framework-middleware");
  assert.equal(calls.some((call) => call.name.startsWith("search.")), false);
  await assert.rejects(() => octokit.rest.search.repos({ q: "langchain" }), /search/);
  const tree = state.tree.map((entry) => entry.path);
  assert.ok(tree.includes("src/agentic-trust-vercel-ai.ts"));
  assert.ok(tree.includes("llms.txt"));
  assert.ok(tree.includes(".well-known/did.json"));
  assert.ok(tree.includes(".well-known/llms.txt"));
  assert.ok(tree.includes("package.json"));
  assert.ok(tree.includes(".gitignore"));
  const pkg = state.tree.find((entry) => entry.path === "package.json").content;
  const did = state.tree.find((entry) => entry.path === ".well-known/did.json").content;
  assert.match(pkg, /@agentic-trust\/sdk/);
  assert.match(pkg, /@agentic-trust\/vercel-ai-middleware/);
  assert.doesNotMatch(pkg, /trustflow-sdk/);
  assert.match(did, /REPLACE_ME/);
  assert.doesNotMatch(did, /BEGIN PRIVATE KEY/);
  const pull = calls.find((call) => call.name === "pulls.create").args;
  assert.equal(pull.head, "maintainer:agentic-trust/framework-middleware");
  assert.equal(pull.base, "main");
  assert.match(pull.body, /Executive summary: context-poisoning defense/);
  assert.match(pull.body, /does not post to X/);
  const createRef = calls.find((call) => call.name === "git.createRef").args;
  assert.equal(createRef.owner, "maintainer");
  assert.equal(createRef.repo, "starter");

  state.files.set("src/agentic-trust-vercel-ai.ts", "export {};\n");
  await assert.rejects(() => applyEcosystemPlan(plan, octokit), /already has src\/agentic-trust-vercel-ai.ts/);
});

test("apply pushes to an existing fork and syncs when the upstream commit is absent", async () => {
  const [plan] = planAllowlist(allowlist([target({ framework: "llamaindex", repo: "acme/starter" })]));
  const existing = mockOctokit({ fork: "existing" });
  existing.state.missingOnFork = true;
  const opened = await applyEcosystemPlan(plan, existing.octokit);
  assert.equal(opened.createdFork, false);
  assert.equal(existing.calls.some((call) => call.name === "repos.createFork"), false);
  assert.equal(existing.calls.some((call) => call.name === "repos.mergeUpstream"), true);
  assert.equal(opened.head, "maintainer:agentic-trust/framework-middleware");

  const owned = mockOctokit({ login: "acme", fork: "missing" });
  const direct = await applyEcosystemPlan(plan, owned.octokit);
  assert.equal(direct.fork, "acme/starter");
  assert.equal(direct.head, "agentic-trust/framework-middleware");
  assert.equal(owned.calls.some((call) => call.name === "repos.createFork"), false);

  const collision = mockOctokit({ login: "other" });
  await assert.rejects(() => applyEcosystemPlan(plan, collision.octokit), /not a fork of acme\/starter/);
});

test("github and octokit clients refuse search and a missing token", async () => {
  assert.throws(() => createGithubClient({ token: "  " }), /GITHUB_TOKEN/);
  const client = createGithubClient({
    token: "test-token",
    fetchImpl: async () => {
      throw new Error("network should not be called");
    },
  });
  await assert.rejects(() => client.request("GET", "/search/repositories"), /search/);

  assert.throws(() => createOctokitClient({ token: "  " }), /GITHUB_TOKEN/);
  class FakeOctokit {
    constructor() {
      this.rest = {
        search: {
          repos: async () => ({ data: { items: [] } }),
        },
      };
      this.request = async () => ({ data: {} });
    }
  }
  const octokit = createOctokitClient({ token: "test-token", OctokitImpl: FakeOctokit });
  await assert.rejects(() => octokit.rest.search.repos({ q: "next.js" }), /search/);
  await assert.rejects(() => octokit.request("GET /search/repositories"), /search/);
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

test("--live gate refuses a missing targets file, the example file, and an empty list", () => {
  const loaded = loadAllowlist(readFileSync(examplePath, "utf8"), examplePath);
  assert.throws(
    () => assertApplyAllowed(allowlist([target()]), { targetsFlag: false, mode: "live" }),
    /--live/
  );
  assert.throws(
    () => assertApplyAllowed(allowlist([target()]), { targetsFlag: false, mode: "live" }),
    /Pass --targets/
  );
  assert.throws(
    () => assertApplyAllowed(allowlist([target()]), { targetsFlag: false, mode: "live" }),
    /does not search GitHub/
  );
  assert.throws(() => assertApplyAllowed(loaded, { targetsFlag: true, mode: "live" }), /example allowlist/);
  assert.throws(() => assertApplyAllowed(allowlist([]), { targetsFlag: true, mode: "live" }), /no targets/);
  assert.throws(() => createOctokitClient({ token: "  ", mode: "live" }), /GITHUB_TOKEN or GH_TOKEN is required for --live/);
});

test("dry-run does not call Octokit; --live without targets refuses; --live with targets opens a pull request", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ecosystem-live-"));
  const file = path.join(directory, "targets.json");
  writeFileSync(
    file,
    JSON.stringify({ example: false, targets: [target({ repo: "acme/starter", framework: "langchain" })] })
  );
  const empty = path.join(directory, "empty.json");
  writeFileSync(empty, JSON.stringify({ example: false, targets: [] }));

  const { octokit, calls } = mockOctokit({
    files: new Map([["package.json", '{\n  "name": "starter",\n  "dependencies": {}\n}\n']]),
  });
  const tokenEnv = { GITHUB_TOKEN: "test-token" };

  const dry = await run(["--targets", file], tokenEnv, { octokit });
  assert.equal(dry.exitCode, 0);
  assert.match(dry.output, /mode: dry-run/);
  assert.match(dry.output, /Dry run only/);
  assert.equal(calls.length, 0);

  await assert.rejects(() => run(["--live"], tokenEnv, { octokit }), /Pass --targets/);
  await assert.rejects(() => run(["--live"], tokenEnv, { octokit }), /does not search GitHub/);
  assert.equal(calls.length, 0);

  await assert.rejects(() => run(["--live", "--targets", file], {}, { octokit }), /GITHUB_TOKEN/);
  assert.equal(calls.length, 0);

  const cleaned = { ...process.env };
  delete cleaned.GITHUB_TOKEN;
  delete cleaned.GH_TOKEN;
  const liveNoTargets = spawnSync(process.execPath, [script, "--live"], { encoding: "utf8", env: cleaned });
  assert.equal(liveNoTargets.status, 1);
  assert.match(liveNoTargets.stderr, /--live/);
  assert.match(liveNoTargets.stderr, /--targets/);
  assert.match(liveNoTargets.stderr, /does not search GitHub/);

  const liveExample = spawnSync(process.execPath, [script, "--live", "--targets", examplePath], {
    encoding: "utf8",
    env: { ...cleaned, GITHUB_TOKEN: "test-token" },
  });
  assert.equal(liveExample.status, 1);
  assert.match(liveExample.stderr, /example allowlist/);

  const liveEmpty = spawnSync(process.execPath, [script, "--live", "--targets", empty], {
    encoding: "utf8",
    env: { ...cleaned, GITHUB_TOKEN: "test-token" },
  });
  assert.equal(liveEmpty.status, 1);
  assert.match(liveEmpty.stderr, /no targets/);

  const liveMissingToken = spawnSync(process.execPath, [script, "--live", "--targets", file], {
    encoding: "utf8",
    env: cleaned,
  });
  assert.equal(liveMissingToken.status, 1);
  assert.match(liveMissingToken.stderr, /GITHUB_TOKEN/);

  const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--live/);
  assert.match(help.stdout, /dry run/i);
  assert.doesNotMatch(help.stdout, /npm install trustflow-sdk/);

  const opened = await run(["--live", "--targets", file], tokenEnv, { octokit });
  assert.equal(opened.exitCode, 0);
  assert.match(opened.output, /https:\/\/github.com\/acme\/starter\/pull\/3/);
  assert.equal(calls.some((call) => call.name.startsWith("search.")), false);
  assert.equal(calls.some((call) => call.name === "repos.createFork"), true);
  assert.equal(calls.some((call) => call.name === "pulls.create"), true);
  await assert.rejects(() => octokit.rest.search.repos({ q: "langchain starter" }), /search/);
  const pull = calls.find((call) => call.name === "pulls.create").args;
  assert.equal(pull.owner, "acme");
  assert.equal(pull.repo, "starter");
  assert.doesNotMatch(pull.body, /npm install trustflow-sdk/);
});
