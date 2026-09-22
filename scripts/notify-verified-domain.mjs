#!/usr/bin/env node
/**
 * Report that a domain reached 100/100 VERIFIED.
 * Dry-run unless --send. Posts only to VERIFIED_NOTIFY_WEBHOOK.
 * Does not post to X. Sharing on X is a separate explicit step.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVerifiedNotifyPayload,
  isCompleteVerification,
  notifyVerifiedDomain,
} from "../packages/sdk/dist/verifiedNotify.js";

function parseArgs(argv) {
  const args = {
    help: false,
    send: false,
    domain: undefined,
    status: "VERIFIED",
    score: undefined,
    maxScore: undefined,
    webhook: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--send") args.send = true;
    else if (arg === "--domain") args.domain = next();
    else if (arg === "--status") args.status = next();
    else if (arg === "--score") args.score = Number(next());
    else if (arg === "--max-score") args.maxScore = Number(next());
    else if (arg === "--webhook") args.webhook = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function helpText() {
  return [
    "Usage: node scripts/notify-verified-domain.mjs --domain <host> --score 100 [--status VERIFIED] [--send]",
    "",
    "Default is a dry run. --send POSTs JSON to VERIFIED_NOTIFY_WEBHOOK, or to --webhook.",
    "The request is sent only when status is VERIFIED and the score is 100/100.",
    "This command does not post to X. Sharing on X is a separate explicit step.",
    "",
  ].join("\n");
}

export async function run(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) return { exitCode: 0, output: helpText() };
  if (!args.domain) throw new Error("--domain is required");
  if (!Number.isFinite(args.score)) throw new Error("--score is required");

  const notice = {
    domain: args.domain,
    status: args.status,
    score: args.score,
    ...(args.maxScore === undefined ? {} : { maxScore: args.maxScore }),
  };
  const complete = isCompleteVerification(notice);
  const webhookConfigured = Boolean((args.webhook ?? env.VERIFIED_NOTIFY_WEBHOOK ?? "").trim());

  if (!args.send) {
    const lines = [
      "mode: dry-run",
      `domain: ${args.domain}`,
      `status: ${args.status}`,
      `score: ${args.score}/${args.maxScore ?? 100}`,
      `wouldSend: ${complete && webhookConfigured ? "true" : "false"}`,
      `webhook: ${webhookConfigured ? "set" : "unset"}`,
    ];
    if (complete) {
      lines.push(JSON.stringify(buildVerifiedNotifyPayload(notice), null, 2));
    } else {
      lines.push("reason: not_complete");
    }
    lines.push("Sharing on X is a separate explicit step. This command does not post to X.");
    return { exitCode: 0, output: `${lines.join("\n")}\n` };
  }

  const options = {};
  if (args.webhook !== undefined) options.webhookUrl = args.webhook;
  const result = await notifyVerifiedDomain(notice, options);
  const output = `${JSON.stringify(result)}\nSharing on X is a separate explicit step. This command does not post to X.\n`;
  const failed = result.reason === "request_failed" || result.reason === "webhook_rejected";
  return { exitCode: failed ? 1 : 0, output };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  run(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
