#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { renewBuildSignatures } from "./buildSign.js";

function redact(message: string, secret: string | undefined): string {
  const pem = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
  let out = message.replace(pem, "[redacted-private-key]");
  if (!secret) return out;
  if (secret.length >= 12) out = out.split(secret).join("[redacted]");
  for (const line of secret.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 12 || trimmed.startsWith("-----")) continue;
    out = out.split(trimmed).join("[redacted]");
  }
  return out;
}

const secret = process.env.AGENTIC_TRUST_PRIVATE_KEY;

renewBuildSignatures()
  .then(async (result) => {
    const lines = [
      `AgenticTrust renewed signatures for ${result.domain} (${result.algorithm}).`,
      `DID: ${result.did}`,
      `publicKeyHash: ${result.publicKeyHash || "(unchanged)"}`,
      `rotated: ${result.rotated ? "yes" : "no"}`,
      `llms.txt generated: ${result.llmsGenerated ? "yes" : "no"}`,
      result.dryRun
        ? "Dry run. Public files were not written. The private key was not written."
        : `Wrote ${result.written.length} public files. The private key was not written.`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    const output = process.env.GITHUB_OUTPUT;
    if (output) {
      const body = [
        `public-key-hash=${result.publicKeyHash}`,
        `did=${result.did}`,
        `rotated=${result.rotated ? "true" : "false"}`,
        `llms-generated=${result.llmsGenerated ? "true" : "false"}`,
        "",
      ].join("\n");
      await appendFile(output, body, "utf8");
    }
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redact(message, secret)}\n`);
    process.exitCode = 1;
  });
