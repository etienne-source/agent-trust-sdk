#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runConfirm } from "./confirm.js";
import { runInit } from "./init.js";
import { runGithubSign } from "./sign.js";

const HELP = `AgenticTrust CLI (@agentic-trust/cli)

Protocol and SDK: AgenticTrust. Hosted registry: Trustflow Systems (trustflow.systems).

Usage:
  agentic-trust init [options]
  agentic-trust sign [options]
  agentic-trust confirm [options]
  agentic-trust --help

init
  Look for llms.txt in the project. If it is missing, write one (prompting for
  site name, description, and optional services). Generate a did:web keypair,
  sign .well-known/did.json, and register the domain.

  POST https://api.trustflow.systems/v1/register
  Body: domain, businessName, verificationType (SSL_CHALLENGE | DNS_TXT),
  and the SPKI publicKeyPem from the did:web key.
  Then publish the challenge and POST /v1/register/confirm.

  https://trustflow.systems/api/register is an alias of the API origin above.

sign
  CI entry used by the AgenticTrust GitHub Action. Checks root llms.txt, writes
  the standard template when it is missing, signs a did:web document with
  @agentic-trust/sdk, and POSTs /v1/register. The private key is read from
  AGENTIC_TRUST_PRIVATE_KEY and is never printed.

confirm
  POST /v1/register/confirm using .agentic-trust/registration.json, then print
  the badge.

Options:
  --domain <host>                 Domain to register (example.com)
  --name <site name>              Site / business name
  --description <text>            Short description used in llms.txt
  --services <a,b,c>              Optional comma-separated services
  --verification-type <type>      SSL_CHALLENGE (default) or DNS_TXT
  --api-url <url>                 API base (or set TRUSTFLOW_API_URL)
  --token <token>                 Challenge token for confirm
  --confirm                       During init or sign, confirm in the same run
  --dry-run                       Sign locally and skip POST /v1/register
  --skip-register                 Write local files only
  --force-keys                    Rotate the did:web keypair
  --non-interactive               Do not prompt (CI)
  -h, --help                      Show this help

sign reads AGENTIC_TRUST_PRIVATE_KEY, AGENTIC_TRUST_DOMAIN, and
AGENTIC_TRUST_BUSINESS_NAME from the environment when flags are omitted.
AGENTIC_TRUST_DRY_RUN=true matches --dry-run.

Secrets are written to .agentic-trust/ and that directory is added to
.gitignore. Do not commit private-key.pem.

Install from Git until the @agentic-trust npm scope exists (clone so the
workspace dependency on @agentic-trust/sdk resolves):
  git clone https://github.com/etienne-source/agent-trust-sdk.git
  cd agent-trust-sdk && pnpm install
  pnpm --filter @agentic-trust/cli exec agentic-trust init

The SDK package alone can be added with:
  pnpm add github:etienne-source/agent-trust-sdk#path:/packages/sdk

Do not install the unrelated npm package trustflow-sdk.
`;

interface Parsed {
  command?: string;
  help: boolean;
  domain?: string;
  name?: string;
  description?: string;
  services?: string;
  verificationType?: string;
  apiUrl?: string;
  token?: string;
  confirm: boolean;
  dryRun: boolean;
  skipRegister: boolean;
  forceKeys: boolean;
  nonInteractive: boolean;
}

function parse(argv: string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      domain: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      services: { type: "string" },
      "verification-type": { type: "string" },
      "api-url": { type: "string" },
      token: { type: "string" },
      confirm: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "skip-register": { type: "boolean", default: false },
      "force-keys": { type: "boolean", default: false },
      "non-interactive": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length > 1) {
    throw new Error(`Unexpected argument: ${positionals.slice(1).join(" ")}`);
  }
  const command = positionals[0];
  if (command && command !== "init" && command !== "confirm" && command !== "sign" && command !== "help") {
    throw new Error(`Unknown command: ${command}`);
  }
  return {
    command,
    help: values.help || command === "help",
    domain: values.domain,
    name: values.name,
    description: values.description,
    services: values.services,
    verificationType: values["verification-type"],
    apiUrl: values["api-url"],
    token: values.token,
    confirm: values.confirm,
    dryRun: values["dry-run"],
    skipRegister: values["skip-register"],
    forceKeys: values["force-keys"],
    nonInteractive: values["non-interactive"],
  };
}

export async function main(argv: string[], io?: {
  cwd?: string;
  fetch?: typeof fetch;
  stdinIsTTY?: boolean;
  prompt?: (question: string) => Promise<string>;
  log?: (line?: string) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<number> {
  const log = io?.log ?? ((line?: string) => console.log(line ?? ""));
  let parsed: Parsed;
  try {
    parsed = parse(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(HELP);
    return 1;
  }

  if (!parsed.command || parsed.help) {
    log(HELP.trimEnd());
    return 0;
  }

  const cwd = io?.cwd ?? process.cwd();
  const fetchFn = io?.fetch ?? globalThis.fetch;
  const env = io?.env ?? process.env;
  try {
    if (parsed.command === "sign") {
      const confirm =
        parsed.confirm || envFlag(env.AGENTIC_TRUST_CONFIRM, true);
      return await runGithubSign({
        cwd,
        domain: parsed.domain ?? env.AGENTIC_TRUST_DOMAIN,
        name: parsed.name ?? env.AGENTIC_TRUST_BUSINESS_NAME,
        description: parsed.description ?? env.AGENTIC_TRUST_DESCRIPTION,
        services: parsed.services ?? env.AGENTIC_TRUST_SERVICES,
        verificationType: parsed.verificationType ?? env.AGENTIC_TRUST_VERIFICATION_TYPE,
        apiUrl: parsed.apiUrl,
        envApiUrl: env.TRUSTFLOW_API_URL,
        privateKeyPem: env.AGENTIC_TRUST_PRIVATE_KEY,
        dryRun: parsed.dryRun || envFlag(env.AGENTIC_TRUST_DRY_RUN, false),
        confirm,
        requireLive: envFlag(env.AGENTIC_TRUST_REQUIRE_LIVE, false),
        fetch: fetchFn,
        log,
        githubOutput: env.GITHUB_OUTPUT,
        githubSummary: env.GITHUB_STEP_SUMMARY,
      });
    }
    if (parsed.command === "init") {
      const prompt = io?.prompt ?? defaultPrompt;
      return await runInit({
        cwd,
        domain: parsed.domain,
        name: parsed.name,
        description: parsed.description,
        services: parsed.services,
        verificationType: parsed.verificationType,
        apiUrl: parsed.apiUrl,
        envApiUrl: env.TRUSTFLOW_API_URL,
        nonInteractive: parsed.nonInteractive,
        stdinIsTTY: io?.stdinIsTTY ?? Boolean(process.stdin.isTTY),
        confirm: parsed.confirm,
        skipRegister: parsed.skipRegister,
        forceKeys: parsed.forceKeys,
        fetch: fetchFn,
        prompt,
        log,
      });
    }
    return await runConfirm({
      cwd,
      domain: parsed.domain,
      token: parsed.token,
      apiUrl: parsed.apiUrl,
      envApiUrl: env.TRUSTFLOW_API_URL,
      fetch: fetchFn,
      log,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`${question}: `);
  } finally {
    rl.close();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
