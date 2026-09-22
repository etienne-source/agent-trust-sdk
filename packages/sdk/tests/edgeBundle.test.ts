import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("edge bundle", () => {
  it("stays under 10KB minified", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/measure-edge.mjs"], {
      cwd: packageRoot,
    });
    const report = JSON.parse(stdout) as {
      method: string;
      results: Array<{ name: string; minifiedBytes: number; gzipBytes: number; limitBytes: number }>;
    };
    expect(report.method).toContain("esbuild");
    expect(report.results.length).toBeGreaterThanOrEqual(2);
    for (const result of report.results) {
      expect(result.minifiedBytes).toBeGreaterThan(0);
      expect(result.minifiedBytes).toBeLessThan(10 * 1024);
      expect(result.gzipBytes).toBeLessThan(result.minifiedBytes);
    }
  });
});
