import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { repoRoot } from "./lib/starter-prs.mjs";

const root = repoRoot();

const publishable = [
  ["@trustflow/sdk", "packages/sdk/package.json", "packages/sdk"],
  ["@trustflow/cli", "packages/cli/package.json", "packages/cli"],
  ["@trustflow/mcp-server", "packages/mcp-server/package.json", "packages/mcp-server"],
  ["@trustflow/next-plugin", "packages/next-plugin/package.json", "packages/next-plugin"],
  ["@trustflow/langchain-middleware", "packages/langchain-middleware/package.json", "packages/langchain-middleware"],
  ["@trustflow/vercel-ai-middleware", "packages/vercel-ai-middleware/package.json", "packages/vercel-ai-middleware"],
  ["@trustflow/vercel-plugin", "packages/vercel-plugin/package.json", "packages/vercel-plugin"],
];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("publishable packages are 1.0.5 public MIT packages of this repository", () => {
  for (const [name, relativePath, directory] of publishable) {
    const pkg = JSON.parse(read(relativePath));
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, "1.0.5");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.private, undefined);
    assert.equal(pkg.repository.type, "git");
    assert.equal(pkg.repository.url, "git+https://github.com/etienne-source/agent-trust-sdk.git");
    assert.equal(pkg.repository.directory, directory);
    assert.equal(pkg.homepage, "https://github.com/etienne-source/agent-trust-sdk#readme");
    assert.deepEqual(pkg.publishConfig, { access: "public" });
    assert.doesNotMatch(JSON.stringify(pkg), /npm install trustflow-sdk/);
  }

  const server = read("packages/mcp-server/src/server.ts");
  assert.match(server, /const SERVER_VERSION = "1\.0\.0"/);
});

test("npm publish workflow documents NPM_TOKEN and does not publish on pull requests", () => {
  const workflow = read(".github/workflows/publish-npm.yml");
  const doc = read("docs/publishing/npm.md");
  assert.match(workflow, /NPM_TOKEN/);
  assert.match(workflow, /tags:/);
  assert.match(workflow, /"v1\.\*"/);
  assert.match(workflow, /"v\*"/);
  assert.match(workflow, /pnpm --filter "@trustflow\/\*" --fail-if-no-match publish -r --access public --no-git-checks/);
  assert.match(workflow, /bundle:edge/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(doc, /NPM_TOKEN/);
  assert.match(doc, /@trustflow\/sdk/);
  assert.match(doc, /Trustflow Systems/);
  assert.doesNotMatch(doc, /npm install trustflow-sdk/);
  assert.doesNotMatch(workflow, /npm install trustflow-sdk/);
});

test("WordPress plugin and Shopify/Webflow guide host did.json without a hardcoded key", () => {
  const plugin = read("plugins/wordpress/agentic-trust.php");
  const guide = read("docs/cms/shopify-webflow-guide.md");

  assert.match(plugin, /AGENTIC_TRUST_PRIVATE_KEY/);
  assert.match(plugin, /getenv\('AGENTIC_TRUST_PRIVATE_KEY'\)/);
  assert.match(plugin, /get_option/);
  assert.match(plugin, /\/\.well-known\/did\.json/);
  assert.match(plugin, /llms\.txt/);
  assert.match(plugin, /agentic_trust_sign_llms_txt/);
  assert.match(plugin, /Trustflow/);
  assert.match(plugin, /Trustflow Systems/);
  assert.doesNotMatch(plugin, /-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=]{16}/);
  assert.doesNotMatch(plugin, /npm install trustflow-sdk/);

  assert.match(guide, /Shopify/);
  assert.match(guide, /Webflow/);
  assert.match(guide, /theme\.liquid/);
  assert.match(guide, /Custom code/);
  assert.match(guide, /\/\.well-known\/did\.json/);
  assert.match(guide, /AGENTIC_TRUST_DID_JSON/);
  assert.match(guide, /Trustflow/);
  assert.match(guide, /Trustflow Systems/);
  assert.doesNotMatch(guide, /npm install trustflow-sdk/);
  assert.doesNotMatch(guide, /-----BEGIN PRIVATE KEY-----/);
});
