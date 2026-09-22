import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLlmsFile, parseLlms, renderLlms } from "../src/llms.js";

describe("llms", () => {
  it("parses a generated manifest", () => {
    const text = renderLlms({
      name: "Example Co",
      description: "Widgets for agents",
      domain: "example.com",
      services: ["Search", "Docs"],
    });
    const parsed = parseLlms(text);
    expect(parsed.name).toBe("Example Co");
    expect(parsed.description).toBe("Widgets for agents");
    expect(parsed.domain).toBe("example.com");
    expect(parsed.services).toEqual(["Search", "Docs"]);
  });

  it("finds llms.txt in common locations, root first", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-llms-"));
    await mkdir(path.join(cwd, "public"), { recursive: true });
    await writeFile(path.join(cwd, "public", "llms.txt"), "# Public\n");
    await writeFile(path.join(cwd, "llms.txt"), "# Root\n");
    expect(await findLlmsFile(cwd)).toBe(path.join(cwd, "llms.txt"));
  });

  it("finds .well-known/llms.txt when the root file is absent", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-llms-"));
    await mkdir(path.join(cwd, ".well-known"), { recursive: true });
    await writeFile(path.join(cwd, ".well-known", "llms.txt"), "# Known\n");
    expect(await findLlmsFile(cwd)).toBe(path.join(cwd, ".well-known", "llms.txt"));
  });
});
