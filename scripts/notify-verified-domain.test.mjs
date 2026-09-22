import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "notify-verified-domain.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("dry-run prints a 100/100 payload and does not post", () => {
  const result = run(["--domain", "Example.COM", "--score", "100"], {
    VERIFIED_NOTIFY_WEBHOOK: "https://hooks.example.com/secret-path",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mode: dry-run/);
  assert.match(result.stdout, /wouldSend: true/);
  assert.match(result.stdout, /webhook: set/);
  assert.match(result.stdout, /"domain": "example.com"/);
  assert.match(result.stdout, /"score": 100/);
  assert.match(result.stdout, /AgenticTrust/);
  assert.match(result.stdout, /Trustflow Systems/);
  assert.match(result.stdout, /separate explicit step/);
  assert.doesNotMatch(result.stdout, /secret-path/);
  assert.doesNotMatch(result.stdout, /npm install trustflow-sdk/);
  assert.doesNotMatch(result.stdout, /api\.twitter\.com/);
});

test("dry-run skips an incomplete score", () => {
  const result = run(["--domain", "example.com", "--status", "VERIFIED", "--score", "99"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wouldSend: false/);
  assert.match(result.stdout, /not_complete/);
  assert.doesNotMatch(result.stdout, /"event"/);
});

test("--send refuses an X webhook before posting", () => {
  const result = run(
    ["--domain", "example.com", "--score", "100", "--send", "--webhook", "https://api.twitter.com/2/tweets"],
    { VERIFIED_NOTIFY_WEBHOOK: "" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not post to X/);
  assert.match(result.stdout, /webhook_rejected/);
  assert.doesNotMatch(result.stdout, /"sent":true/);
});
