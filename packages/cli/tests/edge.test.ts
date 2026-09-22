import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSignedDidDocument } from "@agentic-trust/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-edge-"));
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line?: string) => lines.push(line ?? "") };
}

describe("CLI adversarial inputs", () => {
  const errors: string[] = [];
  let spy: { mockRestore: () => void } | undefined;

  afterEach(() => {
    spy?.mockRestore();
    errors.length = 0;
    delete process.env.TRUSTFLOW_API_TIMEOUT_MS;
  });

  function captureErrors(): void {
    spy = vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      errors.push(String(line ?? ""));
    });
  }

  it("rejects an unknown verification type without crashing", async () => {
    const cwd = await tempProject();
    const { lines, log } = capture();
    const sign = await main(["sign", "--dry-run", "--domain", "example.com", "--verification-type", "HS256"], {
      cwd,
      log,
      stdinIsTTY: false,
      env: {},
    });
    expect(sign).toBe(1);
    expect(lines.join("\n")).toMatch(/SSL_CHALLENGE or DNS_TXT/);

    captureErrors();
    const init = await main(
      ["init", "--non-interactive", "--skip-register", "--domain", "example.com", "--name", "N", "--description", "D", "--verification-type", "none"],
      { cwd: await tempProject(), log: () => undefined, stdinIsTTY: false }
    );
    expect(init).toBe(1);
    expect(errors.join("\n")).toMatch(/SSL_CHALLENGE or DNS_TXT/);
  });

  it("fails a live sign when the private key is missing or not a PEM", async () => {
    const cwd = await tempProject();
    const missing = capture();
    expect(
      await main(["sign", "--domain", "example.com"], {
        cwd,
        log: missing.log,
        stdinIsTTY: false,
        env: { AGENTIC_TRUST_DRY_RUN: "false" },
      })
    ).toBe(1);
    expect(missing.lines.join("\n")).toContain("AGENTIC_TRUST_PRIVATE_KEY");

    const bad = capture();
    const code = await main(["sign", "--domain", "example.com"], {
      cwd: await tempProject(),
      log: bad.log,
      stdinIsTTY: false,
      env: { AGENTIC_TRUST_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n" },
    });
    expect(code).toBe(1);
    const text = bad.lines.join("\n");
    expect(text).toMatch(/could not be read|Private key/);
    expect(text).not.toContain("not-a-key");
  });

  it("fails closed when register times out, the network drops, or the body is the wrong format", async () => {
    const identity = await createSignedDidDocument({ domain: "edge.example" });
    const env = {
      AGENTIC_TRUST_PRIVATE_KEY: identity.privateKeyPem,
      AGENTIC_TRUST_DRY_RUN: "false",
      AGENTIC_TRUST_CONFIRM: "false",
    };

    const timeoutLog = capture();
    const timeout = await main(["sign", "--domain", "edge.example"], {
      cwd: await tempProject(),
      log: timeoutLog.log,
      stdinIsTTY: false,
      env,
      fetch: (async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as typeof fetch,
    });
    expect(timeout).toBe(1);
    expect(timeoutLog.lines.join("\n")).toMatch(/timed out/);
    expect(timeoutLog.lines.join("\n")).not.toContain("PRIVATE KEY");

    const down = capture();
    const dropped = await main(["sign", "--domain", "edge.example"], {
      cwd: await tempProject(),
      log: down.log,
      stdinIsTTY: false,
      env,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(dropped).toBe(1);
    expect(down.lines.join("\n")).toMatch(/request failed/);
    expect(down.lines.join("\n")).not.toContain(identity.privateKeyPem);

    const html = capture();
    const wrong = await main(["sign", "--domain", "edge.example"], {
      cwd: await tempProject(),
      log: html.log,
      stdinIsTTY: false,
      env,
      fetch: (async () => new Response("<html>nope</html>", { status: 200 })) as typeof fetch,
    });
    expect(wrong).toBe(1);
    expect(html.lines.join("\n")).toMatch(/non-JSON/);

    const incomplete = capture();
    const missingFields = await main(["sign", "--domain", "edge.example"], {
      cwd: await tempProject(),
      log: incomplete.log,
      stdinIsTTY: false,
      env,
      fetch: (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
    });
    expect(missingFields).toBe(1);
    expect(incomplete.lines.join("\n")).toMatch(/challengeToken/);
  });

  it("aborts a hung register call from the request timeout", async () => {
    process.env.TRUSTFLOW_API_TIMEOUT_MS = "30";
    const identity = await createSignedDidDocument({ domain: "slow.example" });
    const { lines, log } = capture();
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        const onAbort = () => reject(new DOMException("The operation was aborted", "TimeoutError"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    });
    const code = await main(["sign", "--domain", "slow.example"], {
      cwd: await tempProject(),
      log,
      stdinIsTTY: false,
      env: {
        AGENTIC_TRUST_PRIVATE_KEY: identity.privateKeyPem,
        AGENTIC_TRUST_DRY_RUN: "false",
        AGENTIC_TRUST_CONFIRM: "false",
        TRUSTFLOW_API_TIMEOUT_MS: "30",
      },
      fetch: fetch as unknown as typeof fetch,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/timed out/);
  });

  it("reports a missing or corrupt registration file on confirm", async () => {
    captureErrors();
    const missing = await main(["confirm", "--domain", "example.com"], {
      cwd: await tempProject(),
      log: () => undefined,
      stdinIsTTY: false,
    });
    expect(missing).toBe(1);
    expect(errors.join("\n")).toMatch(/challengeToken/);

    errors.length = 0;
    const cwd = await tempProject();
    await mkdir(path.join(cwd, ".agentic-trust"));
    await writeFile(path.join(cwd, ".agentic-trust", "registration.json"), "<<<not json", "utf8");
    const corrupt = await main(["confirm"], { cwd, log: () => undefined, stdinIsTTY: false });
    expect(corrupt).toBe(1);
    expect(errors.join("\n")).toMatch(/not valid JSON/);

    errors.length = 0;
    await writeFile(path.join(cwd, ".agentic-trust", "registration.json"), "[]", "utf8");
    const arrayFile = await main(["confirm"], { cwd, log: () => undefined, stdinIsTTY: false });
    expect(arrayFile).toBe(1);
    expect(errors.join("\n")).toMatch(/not a JSON object/);
  });

  it("does not crash when llms.txt is a directory or not a manifest", async () => {
    captureErrors();
    const asDir = await tempProject();
    await mkdir(path.join(asDir, "llms.txt"));
    const blocked = await main(
      ["init", "--non-interactive", "--skip-register", "--domain", "example.com", "--name", "N", "--description", "D"],
      { cwd: asDir, log: () => undefined, stdinIsTTY: false }
    );
    expect(blocked).toBe(1);

    errors.length = 0;
    const garbage = await tempProject();
    await writeFile(path.join(garbage, "llms.txt"), "\0\0 this is not a manifest", "utf8");
    const unreadable = await main(["init", "--non-interactive", "--skip-register", "--domain", "example.com"], {
      cwd: garbage,
      log: () => undefined,
      stdinIsTTY: false,
    });
    expect(unreadable).toBe(1);
    expect(errors.join("\n")).toMatch(/Site name is required/);
  });

  it("rejects an invalid domain on init", async () => {
    captureErrors();
    const code = await main(
      ["init", "--non-interactive", "--skip-register", "--domain", "not a host", "--name", "N", "--description", "D"],
      { cwd: await tempProject(), log: () => undefined, stdinIsTTY: false }
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/Invalid URL|invalid/i);
  });
});
