import fs from "node:fs";
import path from "node:path";

/**
 * Printed when a development server loads a project whose Trustflow
 * domain identity files are missing or invalid. The Next.js build is not failed.
 */
export const AGENTIC_TRUST_DEV_WARNING =
  "[Trustflow Warning] Domain identity unverified. Run 'npx @trustflow/cli@latest init' to generate did:web identity.";

const LLMS_RELATIVE = path.join("public", "llms.txt");
const DID_RELATIVE = path.join("public", ".well-known", "did.json");

export interface WithAgenticTrustOptions {
  /**
   * Project root that contains `public/`.
   * Defaults to the directory Next.js passes into `webpack`, then `process.cwd()`.
   */
  cwd?: string;
}

export type AgenticTrustWebpackConfig = Record<string, unknown>;

export interface AgenticTrustWebpackContext {
  dir?: string;
  dev?: boolean;
  isServer?: boolean;
  [key: string]: unknown;
}

export type AgenticTrustWebpackFn = (
  config: AgenticTrustWebpackConfig,
  context: AgenticTrustWebpackContext
) => AgenticTrustWebpackConfig | void;

export interface AgenticTrustNextConfig {
  webpack?: AgenticTrustWebpackFn;
  [key: string]: unknown;
}

export type AgenticTrustWrappedConfig<T extends AgenticTrustNextConfig> = Omit<T, "webpack"> & {
  webpack: AgenticTrustWebpackFn;
};

type NextConfigFunction<T extends AgenticTrustNextConfig> = (
  phase: string,
  context: { defaultConfig: AgenticTrustNextConfig }
) => T | Promise<T>;

function readTextFile(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return undefined;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isValidLlms(text: string | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

function isValidDid(text: string | undefined): boolean {
  if (!isValidLlms(text)) return false;
  try {
    JSON.parse(text as string);
    return true;
  } catch {
    return false;
  }
}

/** True when both public identity files exist and are usable. */
export function projectIdentityVerified(cwd: string): boolean {
  const llms = readTextFile(path.join(cwd, LLMS_RELATIVE));
  const did = readTextFile(path.join(cwd, DID_RELATIVE));
  return isValidLlms(llms) && isValidDid(did);
}

function resolveProjectDir(cwd: string | undefined, fallback: string | undefined): string {
  const preferred = cwd?.trim() ? cwd : fallback;
  return path.resolve(preferred?.trim() ? preferred : process.cwd());
}

function warnUnverified(): void {
  try {
    console.warn(AGENTIC_TRUST_DEV_WARNING);
  } catch {
    // A broken console must not fail `next dev` or `next build`.
  }
}

function attachDevIdentityCheck<T extends AgenticTrustNextConfig>(
  nextConfig: T,
  options: WithAgenticTrustOptions
): AgenticTrustWrappedConfig<T> {
  const checked = new Set<string>();

  const run = (cwd: string | undefined, fallback?: string): void => {
    if (process.env.NODE_ENV !== "development") return;
    const projectDir = resolveProjectDir(cwd, fallback ?? options.cwd);
    if (checked.has(projectDir)) return;
    checked.add(projectDir);
    let verified = false;
    try {
      verified = projectIdentityVerified(projectDir);
    } catch {
      verified = false;
    }
    if (!verified) warnUnverified();
  };

  run(options.cwd);

  const userWebpack = nextConfig.webpack;
  const webpack: AgenticTrustWebpackFn = (config, context) => {
    const dir = context && typeof context.dir === "string" ? context.dir : undefined;
    run(dir, options.cwd ?? process.cwd());
    if (typeof userWebpack === "function") {
      return userWebpack(config, context);
    }
    return config;
  };

  return {
    ...nextConfig,
    webpack,
  };
}

/**
 * Wrap a Next.js config and attach a development-time Trustflow identity check.
 *
 * When `NODE_ENV` is `development`, the wrapper checks `public/llms.txt` and
 * `public/.well-known/did.json`. Missing, empty, unreadable, or non-JSON
 * identity files print a terminal warning. The returned config is the input
 * spread through, with `webpack` composed so Next.js runs the same check.
 * Production builds stay quiet and are never failed by this plugin.
 */
export function withAgenticTrust<T extends AgenticTrustNextConfig>(
  nextConfig: NextConfigFunction<T>,
  options?: WithAgenticTrustOptions
): (
  phase: string,
  context: { defaultConfig: AgenticTrustNextConfig }
) => AgenticTrustWrappedConfig<T> | Promise<AgenticTrustWrappedConfig<T>>;
export function withAgenticTrust<T extends AgenticTrustNextConfig>(
  nextConfig?: T,
  options?: WithAgenticTrustOptions
): AgenticTrustWrappedConfig<T>;
export function withAgenticTrust<T extends AgenticTrustNextConfig>(
  nextConfig?: T | NextConfigFunction<T>,
  options: WithAgenticTrustOptions = {}
):
  | AgenticTrustWrappedConfig<T>
  | ((
      phase: string,
      context: { defaultConfig: AgenticTrustNextConfig }
    ) => AgenticTrustWrappedConfig<T> | Promise<AgenticTrustWrappedConfig<T>>) {
  if (typeof nextConfig === "function") {
    return (phase, context) => {
      const resolved = nextConfig(phase, context);
      if (resolved instanceof Promise) {
        return resolved.then((config) => attachDevIdentityCheck(config ?? ({} as T), options));
      }
      return attachDevIdentityCheck(resolved ?? ({} as T), options);
    };
  }
  return attachDevIdentityCheck(nextConfig ?? ({} as T), options);
}
