import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPublishedLlms, parseLlms, publishLlms, renderLlms } from "../src/llms.js";

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

  it("prefers the published public/ copy over a stray root llms.txt", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-llms-"));
    await mkdir(path.join(cwd, "public"), { recursive: true });
    await writeFile(path.join(cwd, "public", "llms.txt"), "# Public\n");
    await writeFile(path.join(cwd, "llms.txt"), "# Root\n");
    const found = await findPublishedLlms(cwd, "public", false);
    expect(found).toMatchObject({ path: "public/llms.txt", name: "Public" });
  });

  it("falls back to another llms.txt when nothing is published yet", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-llms-"));
    await mkdir(path.join(cwd, ".well-known"), { recursive: true });
    await writeFile(path.join(cwd, ".well-known", "llms.txt"), "# Known\n");
    expect(await findPublishedLlms(cwd, "public", false)).toMatchObject({ path: ".well-known/llms.txt" });
  });

  it("refuses published copies that differ", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-llms-"));
    await mkdir(path.join(cwd, "public", ".well-known"), { recursive: true });
    await writeFile(path.join(cwd, "public", "llms.txt"), "# One\n");
    await writeFile(path.join(cwd, "public", ".well-known", "llms.txt"), "# Two\n");
    await expect(findPublishedLlms(cwd, "public", false)).rejects.toThrow(/differ/);
  });

  it("writes only the published copies that are missing", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-llms-"));
    await mkdir(path.join(cwd, "public"), { recursive: true });
    await writeFile(path.join(cwd, "public", "llms.txt"), "# Mine\n");
    const written = await publishLlms(cwd, "public", false, "# Mine\n");
    expect(written).toEqual([path.join(cwd, "public", ".well-known", "llms.txt")]);
  });
});
