import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectIdentityVerified } from "../packages/next-plugin/dist/index.js";

const startersRoot = path.dirname(fileURLToPath(import.meta.url));
const starters = [
  { name: "nextjs", config: "next.config.ts" },
  { name: "v0", config: "next.config.mjs" },
  { name: "bolt", config: "next.config.js" },
];

const required = [
  "package.json",
  "README.md",
  "tsconfig.json",
  "app/layout.tsx",
  "app/page.tsx",
  "app/globals.css",
  "public/llms.txt",
  "public/.well-known/llms.txt",
  "public/.well-known/did.json",
  ".cursorrules",
  ".cursor/rules/agentic-trust.mdc",
  ".gitignore",
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(starter, relative) {
  return readFileSync(path.join(startersRoot, starter, relative), "utf8");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

for (const starter of starters) {
  const dir = path.join(startersRoot, starter.name);
  for (const relative of required) {
    try {
      statSync(path.join(dir, relative));
    } catch {
      fail(`${starter.name}: missing ${relative}`);
    }
  }

  const configNames = ["next.config.ts", "next.config.mjs", "next.config.js"];
  for (const name of configNames) {
    const exists = (() => {
      try {
        statSync(path.join(dir, name));
        return true;
      } catch {
        return false;
      }
    })();
    if (name === starter.config && !exists) fail(`${starter.name}: missing ${name}`);
    if (name !== starter.config && exists) fail(`${starter.name}: unexpected ${name}`);
  }

  let configText = "";
  try {
    configText = read(starter.name, starter.config);
  } catch {
    configText = "";
  }
  if (!configText.includes("withAgenticTrust")) {
    fail(`${starter.name}: ${starter.config} does not call withAgenticTrust`);
  }
  if (!configText.includes("turbopack")) {
    fail(`${starter.name}: ${starter.config} needs turbopack: {} so Next.js 16 accepts the plugin webpack hook`);
  }
  if (starter.name === "bolt" && !configText.includes("module.exports")) {
    fail("bolt: next.config.js should use module.exports for WebContainers");
  }
  if (starter.name === "v0" && !configText.includes("export default")) {
    fail("v0: next.config.mjs should default-export the wrapped config");
  }

  let did;
  try {
    did = JSON.parse(read(starter.name, "public/.well-known/did.json"));
  } catch (error) {
    fail(`${starter.name}: did.json is not JSON (${error instanceof Error ? error.message : error})`);
  }
  const didText = JSON.stringify(did ?? {});
  if (!didText.includes("REPLACE_ME")) fail(`${starter.name}: did.json is missing REPLACE_ME`);
  if (did?.proof?.jws && did.proof.jws !== "REPLACE_ME") {
    fail(`${starter.name}: proof.jws must stay the REPLACE_ME placeholder`);
  }

  const llms = read(starter.name, "public/llms.txt");
  const llmsWellKnown = read(starter.name, "public/.well-known/llms.txt");
  if (llms !== llmsWellKnown) fail(`${starter.name}: llms.txt copies differ`);
  if (!llms.includes("REPLACE_ME.example")) fail(`${starter.name}: llms.txt domain placeholder missing`);
  if (!llms.includes("Verified Domain Context | Trustflow") || !llms.includes("https://trustflow.systems")) {
    fail(`${starter.name}: llms.txt missing Trustflow badge line`);
  }

  const rules = read(starter.name, ".cursorrules");
  const mdc = read(starter.name, ".cursor/rules/agentic-trust.mdc");
  for (const [label, text] of [
    [".cursorrules", rules],
    [".cursor/rules/agentic-trust.mdc", mdc],
  ]) {
    if (!text.includes("did:web") || !text.includes("public/llms.txt")) {
      fail(`${starter.name}: ${label} is missing did:web or llms.txt rules`);
    }
    if (!text.includes("trustflow-sdk")) {
      fail(`${starter.name}: ${label} should forbid trustflow-sdk`);
    }
  }

  const pkg = JSON.parse(read(starter.name, "package.json"));
  const spec = pkg.dependencies?.["@trustflow/next-plugin"];
  if (spec !== "github:etienne-source/agent-trust-sdk#path:/packages/next-plugin") {
    fail(`${starter.name}: plugin dependency is ${spec}`);
  }
  if (JSON.stringify(pkg).includes("trustflow-sdk")) {
    fail(`${starter.name}: package.json mentions trustflow-sdk`);
  }
  if (pkg.scripts?.dev !== "next dev") fail(`${starter.name}: dev script should be next dev`);

  const readme = read(starter.name, "README.md");
  if (!readme.includes("npx @trustflow/cli@latest init")) {
    fail(`${starter.name}: README does not lead with npx @trustflow/cli@latest init`);
  }
  if (!readme.includes("Trustflow")) {
    fail(`${starter.name}: README missing Trustflow`);
  }
  if (readme.includes("npm install trustflow-sdk") && !readme.includes("Do not install `trustflow-sdk`")) {
    fail(`${starter.name}: README documents installing trustflow-sdk`);
  }

  if (!projectIdentityVerified(dir)) {
    fail(`${starter.name}: projectIdentityVerified is false`);
  }

  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    if (text.includes("BEGIN PRIVATE KEY") || text.includes("BEGIN OPENSSH PRIVATE KEY")) {
      fail(`${starter.name}: private key material in ${path.relative(dir, file)}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`starters ok: ${starters.map((starter) => starter.name).join(", ")}`);
