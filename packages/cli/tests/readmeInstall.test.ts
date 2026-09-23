import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const INSTALL = "npx @trustflow/cli@latest init";

function readmes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      readmes(full, acc);
    } else if (entry === "README.md") {
      acc.push(full);
    }
  }
  return acc;
}

describe("README install path", () => {
  it("documents npx @trustflow/cli@latest init as the product install", () => {
    const files = readmes(repoRoot);
    const required = [
      path.join(repoRoot, "README.md"),
      path.join(repoRoot, "packages/cli/README.md"),
      path.join(repoRoot, "packages/sdk/README.md"),
      path.join(repoRoot, "packages/mcp-server/README.md"),
      path.join(repoRoot, "packages/next-plugin/README.md"),
      path.join(repoRoot, "packages/vercel-plugin/README.md"),
    ];
    for (const file of required) {
      expect(files).toContain(file);
      const text = readFileSync(file, "utf8");
      expect(text.includes(INSTALL), `${path.relative(repoRoot, file)} documents ${INSTALL}`).toBe(true);
      expect(text.includes("npm install trustflow-sdk") && !/do not (install|run)/i.test(text), file).toBe(
        false
      );
    }
  });
});
