import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyStarterPlan,
  assertApplyAllowed,
  createGithubClient,
  ensureGitignore,
  formatDryRun,
  loadAllowlist,
  mergePackageDependency,
  planAllowlist,
  repoRoot,
  wrapNextConfig,
} from "./lib/starter-prs.mjs";

const script = path.join(repoRoot(), "scripts", "create-starter-prs.mjs");
const examplePath = path.join(repoRoot(), "scripts", "starter-pr-targets.example.json");

function allowlist(targets, name = "starter-pr-targets.json") {
  return loadAllowlist(
    JSON.stringify({
      example: false,
      targets,
    }),
    name
  );
}

function nextTarget(overrides = {}) {
  return {
    repo: "acme/widgets",
    framework: "next",
    enabled: true,
    domain: "widgets.example",
    name: "Widgets",
    description: "A shop",
    services: ["Catalog"],
    base: "main",
    nextConfig: "ts",
    ...overrides,
  };
}

test("example allowlist is empty and dry-runs without opening a pull request", () => {
  const parsed = JSON.parse(readFileSync(examplePath, "utf8"));
  assert.equal(parsed.example, true);
  assert.deepEqual(parsed.targets, []);
  assert.equal(Array.isArray(parsed.targetShape), false);

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
  assert.throws(() => assertApplyAllowed(allowlist([nextTarget()]), { targetsFlag: false }), /Pass --targets/);
});

test("plans Next.js and LangChain files from the starters", () => {
  const plans = planAllowlist(
    allowlist([
      nextTarget(),
      nextTarget({
        repo: "acme/chain",
        framework: "langchain",
        domain: "chain.example",
        nextConfig: undefined,
        services: [],
      }),
    ])
  );
  assert.equal(plans.length, 2);

  const next = plans[0];
  assert.equal(next.title, "Add AgenticTrust placeholder did:web identity");
  assert.equal(next.branch, "agentic-trust/starter-identity");
  const did = JSON.parse(next.files.find((file) => file.path === "public/.well-known/did.json").content);
  assert.equal(did.id, "did:web:widgets.example");
  assert.equal(did.proof.jws, "REPLACE_ME");
  assert.equal(did.verificationMethod[0].publicKeyPem, "REPLACE_ME");
  assert.equal(did["@context"][0], "https://www.w3.org/ns/did/v1");
  const llms = next.files.find((file) => file.path === "public/llms.txt").content;
  const llmsCopy = next.files.find((file) => file.path === "public/.well-known/llms.txt").content;
  assert.equal(llms, llmsCopy);
  assert.match(llms, /Domain: widgets\.example/);
  assert.match(llms, /Verified by AgenticTrust/);
  assert.match(llms, /Trustflow Systems/);
  assert.match(llms, /Catalog/);
  const snippet = next.files.find((file) => file.path === "agentic-trust/next.config.snippet.ts").content;
  assert.match(snippet, /withAgenticTrust/);
  assert.match(snippet, /turbopack/);
  assert.match(next.files.find((file) => file.path === ".cursorrules").content, /public\/llms\.txt/);
  assert.equal(next.packageDependencies["@trustflow/next-plugin"], "github:etienne-source/agent-trust-sdk#path:/packages/next-plugin");

  const chain = plans[1];
  assert.ok(chain.files.some((file) => file.path === "llms.txt"));
  assert.ok(chain.files.some((file) => file.path === ".well-known/did.json"));
  assert.equal(chain.files.some((file) => file.path.startsWith("public/")), false);
  const wiring = chain.files.find((file) => file.path === "src/agentic-trust.ts").content;
  assert.match(wiring, /agenticTrustLangChainMiddleware/);
  assert.match(wiring, /@trustflow\/sdk/);
  assert.match(wiring, /github:etienne-source\/agent-trust-sdk#path:\/packages\/langchain-middleware/);
  assert.match(chain.files.find((file) => file.path === ".cursorrules").content, /repository root/);
  assert.doesNotMatch(chain.files.find((file) => file.path === ".cursorrules").content, /public\/llms\.txt/);

  const rendered = formatDryRun(allowlist([nextTarget()]), [next]);
  assert.match(rendered, /title: Add AgenticTrust placeholder did:web identity/);
  assert.match(rendered, /--- body ---/);
  assert.match(rendered, /--- public\/\.well-known\/did\.json ---/);
  assert.match(rendered, /does not post to X/);
  for (const plan of plans) {
    const blob = `${plan.body}\n${plan.files.map((file) => file.content).join("\n")}`;
    assert.doesNotMatch(blob, /npm install trustflow-sdk/);
    assert.doesNotMatch(blob, /BEGIN PRIVATE KEY/);
  }
});

test("rejects targets that are not an explicit next or langchain repo", () => {
  assert.throws(() => allowlist([nextTarget({ repo: "https://github.com/acme/widgets" })]), /owner\/name/);
  assert.throws(() => allowlist([nextTarget({ framework: "vite" })]), /framework/);
  assert.throws(() => allowlist([nextTarget({ enabled: false })]), /enabled/);
  assert.throws(() => allowlist([nextTarget({ domain: "not a host" })]), /hostname/);
  assert.throws(
    () => allowlist([nextTarget(), nextTarget()]),
    /Duplicate repo/
  );
  const many = Array.from({ length: 6 }, (_, index) => nextTarget({ repo: `acme/repo-${index}` }));
  assert.throws(() => allowlist(many), /maximum per run is 5/);
});

test("wraps a simple Next config and merges a dependency without replacing the file", () => {
  const wrapped = wrapNextConfig(
    "const nextConfig = {\n  reactStrictMode: true,\n};\nexport default nextConfig;\n",
    "next.config.ts"
  );
  assert.equal(wrapped.wrapped, true);
  assert.match(wrapped.content, /import \{ withAgenticTrust \} from "@trustflow\/next-plugin"/);
  assert.match(wrapped.content, /turbopack: \{\}/);
  assert.match(wrapped.content, /export default withAgenticTrust\(nextConfig\)/);
  assert.match(wrapped.content, /reactStrictMode: true/);

  const cjs = wrapNextConfig(
    "const nextConfig = {\n  reactStrictMode: true,\n};\nmodule.exports = nextConfig;\n",
    "next.config.js"
  );
  assert.match(cjs.content, /require\("@trustflow\/next-plugin"\)/);
  assert.match(cjs.content, /module\.exports = withAgenticTrust\(nextConfig\)/);

  const skipped = wrapNextConfig('export default withAgenticTrust(nextConfig);\n', "next.config.mjs");
  assert.equal(skipped.reason, "already-wrapped");
  const odd = wrapNextConfig("export default factory(config);\n", "next.config.mjs");
  assert.equal(odd.reason, "unrecognized-export");

  const merged = mergePackageDependency(
    '{\n  "name": "widgets",\n  "dependencies": {\n    "next": "^16.0.0"\n  }\n}\n',
    { "@trustflow/next-plugin": "github:etienne-source/agent-trust-sdk#path:/packages/next-plugin" }
  );
  const pkg = JSON.parse(merged);
  assert.equal(pkg.dependencies.next, "^16.0.0");
  assert.equal(
    pkg.dependencies["@trustflow/next-plugin"],
    "github:etienne-source/agent-trust-sdk#path:/packages/next-plugin"
  );
  assert.equal(
    mergePackageDependency(merged, {
      "@trustflow/next-plugin": "github:etienne-source/agent-trust-sdk#path:/packages/next-plugin",
    }),
    null
  );

  const ignore = ensureGitignore("node_modules\n");
  assert.match(ignore, /node_modules/);
  assert.match(ignore, /\.agentic-trust\//);
  assert.match(ignore, /\*\.pem/);
  assert.equal(ensureGitignore(ignore), null);
});

test("apply creates one branch and pull request from the allowlist", async () => {
  const [plan] = planAllowlist(allowlist([nextTarget()]));
  const calls = [];
  const files = new Map([
    [
      "package.json",
      '{\n  "name": "widgets",\n  "dependencies": {\n    "next": "^16.0.0"\n  }\n}\n',
    ],
    ["next.config.ts", "const nextConfig = {\n  reactStrictMode: true,\n};\nexport default nextConfig;\n"],
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
        return { html_url: "https://github.com/acme/widgets/pull/7", number: 7 };
      }
      throw new Error(`unexpected ${method} ${requestPath}`);
    },
  };

  const opened = await applyStarterPlan(plan, github);
  assert.equal(opened.url, "https://github.com/acme/widgets/pull/7");
  assert.equal(calls.some((call) => call.requestPath.includes("/search/")), false);
  const tree = calls.find((call) => call.requestPath.endsWith("/git/trees")).body;
  assert.equal(tree.base_tree, "treesha");
  const paths = tree.tree.map((entry) => entry.path);
  assert.ok(paths.includes("public/.well-known/did.json"));
  assert.ok(paths.includes("public/llms.txt"));
  assert.ok(paths.includes("next.config.ts"));
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes(".gitignore"));
  assert.equal(paths.includes("agentic-trust/next.config.snippet.ts"), false);
  const config = tree.tree.find((entry) => entry.path === "next.config.ts").content;
  assert.match(config, /withAgenticTrust\(nextConfig\)/);
  assert.match(config, /reactStrictMode/);
  const did = tree.tree.find((entry) => entry.path === "public/.well-known/did.json").content;
  assert.match(did, /REPLACE_ME/);
  assert.doesNotMatch(did, /BEGIN PRIVATE KEY/);
  const pull = calls.find((call) => call.requestPath.endsWith("/pulls")).body;
  assert.equal(pull.head, "agentic-trust/starter-identity");
  assert.equal(pull.base, "main");
  assert.doesNotMatch(pull.body, /npm install trustflow-sdk/);
  assert.match(pull.body, /does not post to X/);

  files.set("public/llms.txt", "already there\n");
  await assert.rejects(() => applyStarterPlan(plan, github), /already has public\/llms.txt/);
  assert.equal(
    calls.filter((call) => call.method === "POST" && call.requestPath.endsWith("/pulls")).length,
    1
  );
});

test("github client refuses search and a missing token", async () => {
  assert.throws(() => createGithubClient({ token: "  " }), /GITHUB_TOKEN/);
  let fetched = 0;
  const client = createGithubClient({
    token: "test-token",
    fetchImpl: async () => {
      fetched += 1;
      return new Response("{}", { status: 200 });
    },
  });
  await assert.rejects(() => client.request("GET", "/search/repositories"), /search/);
  assert.equal(fetched, 0);
});

test("cli dry-run smoke", () => {
  const dry = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /mode: dry-run/);
  assert.match(dry.stdout, /targets: 0/);

  const directory = mkdtempSync(path.join(tmpdir(), "starter-prs-"));
  const file = path.join(directory, "targets.json");
  writeFileSync(
    file,
    JSON.stringify({
      example: false,
      targets: [nextTarget({ repo: "acme/dry-run" })],
    })
  );
  const planned = spawnSync(process.execPath, [script, "--targets", file], { encoding: "utf8" });
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /title: Add AgenticTrust placeholder did:web identity/);
  assert.match(planned.stdout, /public\/\.well-known\/did\.json/);
  assert.match(planned.stdout, /REPLACE_ME/);
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
  assert.doesNotMatch(applyMissingToken.stdout, /pull/);
});
