#!/usr/bin/env node
/**
 * Plan pull requests that add Trustflow SDK or fail-closed middleware to
 * AI agent framework starters. Dry-run unless --live (or --apply) and --targets.
 *
 * Does not search GitHub. The example allowlist has no targets.
 * Does not post to X.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEcosystemPlan,
  assertApplyAllowed,
  createOctokitClient,
  formatDryRun,
  loadAllowlist,
  planAllowlist,
  sealOctokit,
} from "./lib/ecosystem-prs.mjs";
import { repoRoot } from "./lib/starter-prs.mjs";

function parseArgs(argv) {
  const args = { apply: false, live: false, help: false, targets: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--live") args.live = true;
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
    "Usage: node scripts/submit-ecosystem-prs.mjs [--targets <allowlist.json>] [--live | --apply]",
    "",
    "Default is a dry run. It prints the pull request title, body, and files.",
    "It does not call GitHub and it does not search for repositories.",
    "",
    "A real GitHub pull request is opened only with --live (or --apply) plus --targets,",
    "when the file is not scripts/ecosystem-targets.example.json, example is not true,",
    "targets is a non-empty allowlist of repositories you maintain, and GITHUB_TOKEN",
    "or GH_TOKEN can create the fork and the pull request.",
    "--live without --targets is refused. The example file is refused.",
    "--live forks the repository (or pushes to your existing fork) with Octokit.",
    "It does not search GitHub and it does not open a pull request for a repository",
    "that is not listed in the targets file.",
    "",
    "Copy scripts/ecosystem-targets.example.json to scripts/ecosystem-targets.json.",
    "That copy is gitignored. Leave targets empty until you mean to open a pull request.",
    "LangChain, LlamaIndex, and Next.js AI boilerplates are documentation examples only.",
    "They are not listed in the example file and this command does not search for them.",
    "Frameworks: langchain, langgraph, vercel-ai, openai-agents, llamaindex, mastra.",
    "This command does not search GitHub and does not post to X.",
    "",
  ].join("\n");
}

export async function run(argv, env = process.env, options = {}) {
  const args = parseArgs(argv);
  if (args.help) return { exitCode: 0, output: helpText() };

  const live = Boolean(args.live || args.apply);
  const mode = args.live ? "live" : "apply";
  const flag = mode === "live" ? "--live" : "--apply";

  if (live && !args.targets) {
    throw new Error(
      `Pass --targets <allowlist.json>. ${flag} does not use the example file and does not search GitHub.`
    );
  }

  const source = args.targets
    ? path.resolve(args.targets)
    : path.join(repoRoot(), "scripts", "ecosystem-targets.example.json");
  const allowlist = loadAllowlist(readFileSync(source, "utf8"), source);
  const plans = planAllowlist(allowlist);

  if (!live) {
    return { exitCode: 0, output: formatDryRun(allowlist, plans) };
  }

  assertApplyAllowed(allowlist, { targetsFlag: Boolean(args.targets), mode });
  const token = (env.GITHUB_TOKEN || env.GH_TOKEN || "").trim();
  if (!token) {
    throw new Error(`GITHUB_TOKEN or GH_TOKEN is required for ${flag}.`);
  }
  const octokit = options.octokit ? sealOctokit(options.octokit) : createOctokitClient({ token, mode });
  const urls = [];
  for (const plan of plans) {
    const opened = await applyEcosystemPlan(plan, octokit);
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
