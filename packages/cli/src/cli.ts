#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runConfirm } from "./confirm.js";
import { runInit } from "./init.js";

const HELP = `AgenticTrust CLI (@agentic-trust/cli)

Protocol and SDK: AgenticTrust. Hosted registry: Trustflow Systems (trustflow.systems).

Usage:
  agentic-trust init [options]
  agentic-trust confirm [options]
  agentic-trust --help

init
  Look for llms.txt in the project. If it is missing, write one (prompting for
  site name, description, and optional services). Generate a did:web keypair,
  sign .well-known/did.json, and register the domain.

  POST https://api.trustflow.systems/v1/register
  Body: domain, businessName, verificationType (SSL_CHALLENGE | DNS_TXT)
  Then publish the challenge and POST /v1/register/confirm.

  https://trustflow.systems/api/register is an alias of the API origin above.

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
  --confirm                       During init, confirm in the same run
  --skip-register                 Write local files only
  --force-keys                    Rotate the did:web keypair
  --non-interactive               Do not prompt (CI)
  -h, --help                      Show this help

Secrets are written to .agentic-trust/ and that directory is added to
.gitignore. Do not commit private-key.pem.

Install from Git until the @agentic-trust npm scope exists:
  pnpm add github:etienne-source/agent-trust-sdk#path:/packages/cli

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
  if (command && command !== "init" && command !== "confirm" && command !== "help") {
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
