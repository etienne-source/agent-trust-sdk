import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAgenticTrust, type AgenticTrustWebpackFn } from "../src/index.js";

const WARNING =
  "[AgenticTrust Warning] Domain identity unverified. Run 'npx agentic-trust init' to generate did:web identity.";

const VALID_LLMS = "# Example\n\nWidgets for agents.\n";
const VALID_DID = JSON.stringify({
  id: "did:web:example.com",
  verificationMethod: [{ publicKeyJwk: { kty: "OKP", crv: "Ed25519" } }],
});

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

let warn: ReturnType<typeof vi.spyOn>;

function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
}

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-next-"));
}

async function writeIdentity(
  root: string,
  files: { llms?: string | null; did?: string | null }
): Promise<void> {
  await mkdir(path.join(root, "public", ".well-known"), { recursive: true });
  if (files.llms != null) {
    await writeFile(path.join(root, "public", "llms.txt"), files.llms, "utf8");
  }
  if (files.did != null) {
    await writeFile(path.join(root, "public", ".well-known", "did.json"), files.did, "utf8");
  }
}

async function makeUnreadable(filePath: string): Promise<void> {
  await chmod(filePath, 0o000);
  try {
    await readFile(filePath, "utf8");
  } catch {
    return;
  }
  await rm(filePath);
  await mkdir(filePath);
}

function webpackOf(config: { webpack?: AgenticTrustWebpackFn }): AgenticTrustWebpackFn {
  if (typeof config.webpack !== "function") {
    throw new Error("expected webpack hook");
  }
  return config.webpack;
}

describe("withAgenticTrust", () => {
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    setNodeEnv(ORIGINAL_NODE_ENV);
  });

  it("warns from the webpack hook when identity files are missing in development", async () => {
    const root = await tempProject();
    setNodeEnv("production");
    const config = withAgenticTrust({ reactStrictMode: true }, { cwd: root });
    expect(warn).not.toHaveBeenCalled();

    setNodeEnv("development");
    const result = webpackOf(config)({ entry: "./app" }, { dir: root, dev: true, isServer: true });

    expect(result).toEqual({ entry: "./app" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);
  });

  it("warns when llms.txt is missing, empty, or whitespace", async () => {
    setNodeEnv("development");
    const missingLlms = await tempProject();
    await writeIdentity(missingLlms, { did: VALID_DID });
    withAgenticTrust({}, { cwd: missingLlms });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);

    warn.mockClear();
    for (const llms of ["", "   \n\t"]) {
      const root = await tempProject();
      await writeIdentity(root, { llms, did: VALID_DID });
      withAgenticTrust({}, { cwd: root });
      expect(warn).toHaveBeenCalledWith(WARNING);
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns when did.json is missing, empty, unreadable, or not JSON", async () => {
    setNodeEnv("development");

    const missingDid = await tempProject();
    await writeIdentity(missingDid, { llms: VALID_LLMS });
    withAgenticTrust({}, { cwd: missingDid });

    const emptyDid = await tempProject();
    await writeIdentity(emptyDid, { llms: VALID_LLMS, did: " \n" });
    withAgenticTrust({}, { cwd: emptyDid });

    const invalidDid = await tempProject();
    await writeIdentity(invalidDid, { llms: VALID_LLMS, did: "{ not json" });
    withAgenticTrust({}, { cwd: invalidDid });

    const directoryDid = await tempProject();
    await mkdir(path.join(directoryDid, "public", ".well-known", "did.json"), { recursive: true });
    await writeFile(path.join(directoryDid, "public", "llms.txt"), VALID_LLMS, "utf8");
    withAgenticTrust({}, { cwd: directoryDid });

    const unreadable = await tempProject();
    await writeIdentity(unreadable, { llms: VALID_LLMS, did: VALID_DID });
    await makeUnreadable(path.join(unreadable, "public", ".well-known", "did.json"));
    withAgenticTrust({}, { cwd: unreadable });

    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn.mock.calls.every((call) => call.length === 1 && call[0] === WARNING)).toBe(true);
  });

  it("does not warn in development when both identity files are valid", async () => {
    const root = await tempProject();
    await writeIdentity(root, { llms: VALID_LLMS, did: VALID_DID });
    setNodeEnv("development");

    const config = withAgenticTrust({ output: "export" }, { cwd: root });
    webpackOf(config)({}, { dir: root, dev: true, isServer: false });

    expect(warn).not.toHaveBeenCalled();
    expect(config.output).toBe("export");
  });

  it.each(["production", "test", undefined])(
    "does not warn when NODE_ENV is %s",
    async (nodeEnv) => {
      const root = await tempProject();
      setNodeEnv(nodeEnv);
      const config = withAgenticTrust({}, { cwd: root });
      webpackOf(config)({}, { dir: root, dev: true, isServer: true });
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it("warns once for the same project across config load and client/server webpack calls", async () => {
    const root = await tempProject();
    setNodeEnv("development");
    const config = withAgenticTrust({}, { cwd: root });
    webpackOf(config)({}, { dir: root, isServer: true });
    webpackOf(config)({}, { dir: root, isServer: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);
  });

  it("checks the Next.js project dir from the webpack hook", async () => {
    const valid = await tempProject();
    const missing = await tempProject();
    await writeIdentity(valid, { llms: VALID_LLMS, did: VALID_DID });
    setNodeEnv("development");

    const config = withAgenticTrust({}, { cwd: valid });
    expect(warn).not.toHaveBeenCalled();

    webpackOf(config)({ mode: "development" }, { dir: missing, dev: true, isServer: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);
  });

  it("uses process.cwd() when no project dir is injected", async () => {
    const root = await tempProject();
    const previous = process.cwd();
    setNodeEnv("development");
    process.chdir(root);
    try {
      withAgenticTrust({});
    } finally {
      process.chdir(previous);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);
  });

  it("spreads the next config and composes an existing webpack function", async () => {
    const root = await tempProject();
    await writeIdentity(root, { llms: VALID_LLMS, did: VALID_DID });
    setNodeEnv("development");
    const images = { unoptimized: true };
    const userWebpack = vi.fn((config: { entry?: string }) => ({ ...config, customized: true }));
    const input = { reactStrictMode: true, images, webpack: userWebpack };

    const output = withAgenticTrust(input, { cwd: root });
    const context = { dir: root, dev: true, isServer: true };
    const result = webpackOf(output)({ entry: "./pages" }, context);

    expect(input.webpack).toBe(userWebpack);
    expect(output.reactStrictMode).toBe(true);
    expect(output.images).toBe(images);
    expect(userWebpack).toHaveBeenCalledWith({ entry: "./pages" }, context);
    expect(result).toEqual({ entry: "./pages", customized: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes a function config through and still attaches the check", async () => {
    const root = await tempProject();
    setNodeEnv("production");
    const wrapped = withAgenticTrust((phase: string) => ({ phase, reactStrictMode: true }), {
      cwd: root,
    });

    const resolved = wrapped("phase-production-build", { defaultConfig: {} });
    expect(warn).not.toHaveBeenCalled();
    expect(resolved.phase).toBe("phase-production-build");
    expect(resolved.reactStrictMode).toBe(true);

    setNodeEnv("development");
    webpackOf(resolved)({}, { dir: root });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);
  });

  it("wraps an async function config", async () => {
    const root = await tempProject();
    await writeIdentity(root, { llms: VALID_LLMS, did: VALID_DID });
    setNodeEnv("development");
    const wrapped = withAgenticTrust(
      async (phase: string) => ({ phase, trailingSlash: true }),
      { cwd: root }
    );

    const resolved = await wrapped("phase-development-server", { defaultConfig: {} });
    expect(resolved.trailingSlash).toBe(true);
    expect(resolved.phase).toBe("phase-development-server");
    expect(typeof resolved.webpack).toBe("function");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not throw when the project directory is missing", () => {
    setNodeEnv("development");
    const cwd = path.join(tmpdir(), "agentic-trust-next-missing", String(Date.now()));
    expect(() => withAgenticTrust({}, { cwd })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(WARNING);
  });
});
