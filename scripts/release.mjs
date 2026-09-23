#!/usr/bin/env node
/**
 * Bump every publishable package to one version and print the tag command.
 * Usage: node scripts/release.mjs 1.0.6
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/release.mjs <major.minor.patch>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "packages/sdk/package.json",
  "packages/cli/package.json",
  "packages/mcp-server/package.json",
  "packages/next-plugin/package.json",
  "packages/vercel-plugin/package.json",
];

for (const relative of packages) {
  const file = path.join(root, relative);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name} ${version}`);
}

console.log(`Tag this commit with: git tag v${version}`);
console.log("Push the tag to publish. CI on main is the test gate.");
