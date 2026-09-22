import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import {
  CURSOR_MDC_RELATIVE,
  CURSORRULES_RELATIVE,
  detectPublicDir,
  mergeCursorRules,
  renderCursorMdc,
  renderCursorRulesFile,
  renderIdeRuleBody,
  writeIdeRules,
} from "../src/ideRules.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-ide-rules-"));
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line?: string) => lines.push(line ?? "") };
}

const initArgs = [
  "init",
  "--non-interactive",
  "--skip-register",
  "--domain",
  "example.com",
  "--name",
  "Example Co",
  "--description",
  "Widgets",
] as const;

describe("IDE rule generator", () => {
  it("includes did:web and signed llms.txt requirements for the default public path", () => {
    const body = renderIdeRuleBody("public");
    const cursorrules = renderCursorRulesFile("public");
    const mdc = renderCursorMdc("public");
    for (const text of [body, cursorrules, mdc]) {
      expect(text).toContain("did:web");
      expect(text).toContain("public/.well-known/did.json");
      expect(text).toContain("public/llms.txt");
      expect(text).toContain("@agentic-trust/sdk");
      expect(text).toContain("createSignedDidDocument");
      expect(text).toMatch(/MUST/);
    }
    expect(mdc).toContain("alwaysApply: true");
    expect(cursorrules).toContain("<!-- agentic-trust:ide-rules -->");
    expect(body).not.toMatch(/npm install trustflow-sdk/);
  });

  it("points rules at static/ when that is the project's public folder", () => {
    const body = renderIdeRuleBody("static");
    expect(body).toContain("static/.well-known/did.json");
    expect(body).toContain("static/llms.txt");
    expect(body).toContain("public/.well-known/did.json");
    expect(body).toContain("public/llms.txt");
  });

  it("writes both rule files and preserves existing .cursorrules content", async () => {
    const cwd = await tempProject();
    await writeFile(path.join(cwd, CURSORRULES_RELATIVE), "# Project rules\nKeep tests green.\n", "utf8");

    const first = await writeIdeRules(cwd);
    expect(first.publicDir).toBe("public");
    expect(first.cursorrules).toBe(path.join(cwd, CURSORRULES_RELATIVE));
    expect(first.mdc).toBe(path.join(cwd, CURSOR_MDC_RELATIVE));

    const cursorrules = await readFile(first.cursorrules, "utf8");
    const mdc = await readFile(first.mdc, "utf8");
    expect(cursorrules).toContain("# Project rules");
    expect(cursorrules).toContain("public/.well-known/did.json");
    expect(cursorrules).toContain("public/llms.txt");
    expect(mdc).toContain("did:web");
    expect(mdc).toContain("createSignedDidDocument");

    await writeIdeRules(cwd);
    const again = await readFile(first.cursorrules, "utf8");
    expect(again.match(/<!-- agentic-trust:ide-rules -->/g)).toHaveLength(1);
    expect(again).toContain("# Project rules");
  });

  it("uses static/ when public/ is absent", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "static"));
    expect(await detectPublicDir(cwd)).toBe("static");
    const written = await writeIdeRules(cwd);
    expect(written.publicDir).toBe("static");
    const mdc = await readFile(written.mdc, "utf8");
    expect(mdc).toContain("static/.well-known/did.json");
    expect(mdc).toContain("static/llms.txt");
  });

  it("prefers public/ when both public folders exist", async () => {
    const cwd = await tempProject();
    await mkdir(path.join(cwd, "public"));
    await mkdir(path.join(cwd, "static"));
    expect(await detectPublicDir(cwd)).toBe("public");
  });

  it("replaces an existing generated block", () => {
    const existing = ["# Keep", "<!-- agentic-trust:ide-rules -->", "old", "<!-- /agentic-trust:ide-rules -->", "# Tail"].join(
      "\n"
    );
    const merged = mergeCursorRules(existing, "<!-- agentic-trust:ide-rules -->\nnew rules\n<!-- /agentic-trust:ide-rules -->\n");
    expect(merged).toContain("# Keep");
    expect(merged).toContain("# Tail");
    expect(merged).toContain("new rules");
    expect(merged).not.toContain("old");
    expect(merged.match(/<!-- agentic-trust:ide-rules -->/g)).toHaveLength(1);
  });
});

describe("agentic-trust init IDE rules", () => {
  it("writes both rule files on a successful init", async () => {
    const cwd = await tempProject();
    const { lines, log } = capture();
    const code = await main([...initArgs], { cwd, log, stdinIsTTY: false });
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain(".cursorrules");
    expect(output).toContain("agentic-trust.mdc");

    const cursorrules = await readFile(path.join(cwd, CURSORRULES_RELATIVE), "utf8");
    const mdc = await readFile(path.join(cwd, CURSOR_MDC_RELATIVE), "utf8");
    expect(cursorrules).toContain("did:web");
    expect(cursorrules).toContain("public/.well-known/did.json");
    expect(cursorrules).toContain("public/llms.txt");
    expect(cursorrules).toContain("@agentic-trust/sdk");
    expect(mdc).toContain("createSignedDidDocument");
    expect(mdc).toContain("public/.well-known/did.json");
  });

  it("skips both rule files when --no-ide-rules is set", async () => {
    const cwd = await tempProject();
    const { lines, log } = capture();
    const code = await main([...initArgs, "--no-ide-rules"], { cwd, log, stdinIsTTY: false });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Skipped IDE rules (--no-ide-rules).");
    await expect(access(path.join(cwd, CURSORRULES_RELATIVE))).rejects.toThrow();
    await expect(access(path.join(cwd, CURSOR_MDC_RELATIVE))).rejects.toThrow();
    const did = await readFile(path.join(cwd, ".well-known", "did.json"), "utf8");
    expect(did).toContain("did:web:example.com");
  });

  it("does not write rule files when init fails", async () => {
    const cwd = await tempProject();
    const code = await main(["init", "--non-interactive", "--skip-register", "--domain", "example.com"], {
      cwd,
      log: () => undefined,
      stdinIsTTY: false,
    });
    expect(code).toBe(1);
    await expect(access(path.join(cwd, CURSORRULES_RELATIVE))).rejects.toThrow();
    await expect(access(path.join(cwd, ".cursor"))).rejects.toThrow();
  });

  it("documents --no-ide-rules in help", async () => {
    const { lines, log } = capture();
    const code = await main(["--help"], { log, stdinIsTTY: false });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("--no-ide-rules");
    expect(text).toContain(".cursorrules");
    expect(text).toContain(".cursor/rules/agentic-trust.mdc");
    expect(text).toContain("public/.well-known/did.json");
  });
});
