import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../dist/cli.js");

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `agentic-trust ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

const help = run(["--help"]);
if (!help.includes("agentic-trust init")) {
  throw new Error("help is missing agentic-trust init");
}
if (!help.includes("https://api.trustflow.systems/v1/register")) {
  throw new Error("help is missing the live register URL");
}

const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-smoke-"));
const output = run(
  [
    "init",
    "--non-interactive",
    "--skip-register",
    "--domain",
    "example.com",
    "--name",
    "Example Co",
    "--description",
    "Smoke",
    "--services",
    "Docs",
  ],
  cwd
);

if (!output.includes("Verified by AgenticTrust | trustflow.systems")) {
  throw new Error("badge label missing from init output");
}
if (!output.includes("https://trustflow.systems/verify/example.com")) {
  throw new Error("badge URL missing from init output");
}
if (output.includes("PRIVATE KEY")) {
  throw new Error("init printed private key material");
}

const gitignore = await readFile(path.join(cwd, ".gitignore"), "utf8");
if (!gitignore.includes(".agentic-trust/")) {
  throw new Error("gitignore was not updated");
}
const did = JSON.parse(await readFile(path.join(cwd, ".well-known", "did.json"), "utf8"));
if (did.id !== "did:web:example.com") {
  throw new Error(`unexpected did id ${did.id}`);
}
const mode = (await stat(path.join(cwd, ".agentic-trust", "private-key.pem"))).mode & 0o777;
if (mode !== 0o600) {
  throw new Error(`private key mode is ${mode.toString(8)}, expected 600`);
}

console.log("smoke ok");
