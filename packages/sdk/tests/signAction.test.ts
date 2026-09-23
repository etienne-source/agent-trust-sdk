import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.github/actions/agentic-trust-sign/action.yml"
);

describe("agentic-trust-sign action", () => {
  it("accepts domain, key secret, and paths, and does not print the private key", async () => {
    const text = await readFile(actionPath, "utf8");
    expect(text).toContain("key-secret:");
    expect(text).toContain("did-path:");
    expect(text).toContain("llms-path:");
    expect(text).toContain("commit:");
    expect(text).toContain("renewCli.js");
    expect(text).not.toMatch(/echo\s+.*AGENTIC_TRUST_PRIVATE_KEY/);
    expect(text).not.toMatch(/console\.log\(.*private/i);
    expect(text).toContain("BEGIN PRIVATE KEY");
    expect(text).toContain("Refusing to commit a private key");
  });
});
