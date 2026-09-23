import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { embedBadge, renderBadge, verifyPageUrl } from "../src/badge.js";

describe("badge", () => {
  it("links to the Trustflow verify page with the required label", () => {
    const html = renderBadge("example.com");
    expect(verifyPageUrl("example.com")).toBe("https://trustflow.systems/verify/example.com");
    expect(html).toContain('href="https://trustflow.systems/verify/example.com"');
    expect(html).toContain("Verified Domain Context | Trustflow");
    expect(html).toContain("<svg");
    expect(html).toContain("</a>");
  });

  it("writes the badge into a layout footer and does not write it twice", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-badge-"));
    const layout = path.join(cwd, "src", "app", "layout.tsx");
    await mkdir(path.dirname(layout), { recursive: true });
    await writeFile(layout, "export default function Layout(){ return <footer>Ready</footer> }\n");
    const written = await embedBadge(cwd, "example.com");
    expect(written).toEqual({ status: "written", file: "src/app/layout.tsx" });
    const html = await readFile(layout, "utf8");
    expect(html).toContain("https://trustflow.systems/verify/example.com");
    expect(html).toContain("</footer>");
    expect(await embedBadge(cwd, "example.com")).toEqual({ status: "present" });
  });
});
