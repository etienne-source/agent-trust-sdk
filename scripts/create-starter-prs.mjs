#!/usr/bin/env node
/**
 * Plan pull requests that add an AgenticTrust placeholder did:web, llms.txt,
 * and Next.js or LangChain wiring. Dry-run unless --apply and --targets.
 *
 * Does not search GitHub. The example allowlist has no targets.
 * Does not post to X.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyStarterPlan,
  assertApplyAllowed,
  createGithubClient,
  formatDryRun,
  loadAllowlist,
  planAllowlist,
  repoRoot,
} from "./lib/starter-prs.mjs";

function parseArgs(argv) {
  const args = { apply: false, help: false, targets: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--targets") {
      const value = argv[index + 1];
      if (!value) throw new Error("--targets requires a file path");
      args.targets = value;
      index += 1;
    } else if (arg.startsWith("--targets=")) {
      args.targets = arg.slice("--targets=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function helpText() {
  return [
    "Usage: node scripts/create-starter-prs.mjs [--targets <allowlist.json>] [--apply]",
    "",
    "Default is a dry run. It prints the pull request title, body, and files.",
    "A real GitHub pull request is opened only when --apply and --targets are both set,",
    "the file is not scripts/starter-pr-targets.example.json, example is not true,",
    "and targets is a non-empty allowlist of repositories you maintain.",
    "",
    "Copy scripts/starter-pr-targets.example.json to scripts/starter-pr-targets.json.",
    "That copy is gitignored. Leave targets empty until you mean to open a pull request.",
    "This command does not search GitHub and does not post to X.",
    "",
  ].join("\n");
}

export async function run(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) return { exitCode: 0, output: helpText() };

  const source = args.targets
    ? path.resolve(args.targets)
    : path.join(repoRoot(), "scripts", "starter-pr-targets.example.json");
  const allowlist = loadAllowlist(readFileSync(source, "utf8"), source);
  const plans = planAllowlist(allowlist);

  if (!args.apply) {
    return { exitCode: 0, output: formatDryRun(allowlist, plans) };
  }

  assertApplyAllowed(allowlist, { targetsFlag: Boolean(args.targets) });
  const github = createGithubClient({
    token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
  });
  const urls = [];
  for (const plan of plans) {
    const opened = await applyStarterPlan(plan, github);
    urls.push(opened.url);
  }
  return { exitCode: 0, output: `${urls.join("\n")}\n` };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  run(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
