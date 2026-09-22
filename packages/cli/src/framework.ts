import { promises as fs } from "node:fs";
import path from "node:path";

/** Checked in order when no framework config names a directory. `public` wins when both exist. */
export const PUBLIC_DIR_CANDIDATES = ["public", "static"] as const;

const NEXT_CONFIGS = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"] as const;
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.mjs", "vite.config.js", "vite.config.cjs"] as const;
const NUXT_CONFIGS = ["nuxt.config.ts", "nuxt.config.mts", "nuxt.config.mjs", "nuxt.config.js"] as const;

export type ProjectFramework = "next" | "vite" | "nuxt" | "unknown";

export interface ProjectLayout {
  framework: ProjectFramework;
  /** Site-root static directory, relative to the project, with no leading slash. */
  publicDir: string;
  reason: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Static folder this repo already uses for public files.
 * Prefers `public/`, then `static/`. Otherwise the AgenticTrust default `public`.
 */
export async function detectPublicDir(cwd: string): Promise<string> {
  for (const name of PUBLIC_DIR_CANDIDATES) {
    if (await isDirectory(cwd, name)) return name;
  }
  return "public";
}

/**
 * Detect Next.js, Vite, or Nuxt and the directory that is served at the site origin.
 * An explicit framework `publicDir` / `dir.public` wins. Otherwise Next.js and Vite
 * use `public/`, Nuxt 2 uses `static/`, and Nuxt 3 uses `public/`. Unknown projects
 * reuse {@link detectPublicDir}.
 */
export async function detectProjectLayout(cwd: string): Promise<ProjectLayout> {
  const pkg = await readPackageJson(cwd);
  const [nextConfig, viteConfig, nuxtConfig] = await Promise.all([
    findConfig(cwd, NEXT_CONFIGS),
    findConfig(cwd, VITE_CONFIGS),
    findConfig(cwd, NUXT_CONFIGS),
  ]);
  const nextVersion = dependencyVersion(pkg, "next");
  const viteVersion = dependencyVersion(pkg, "vite");
  const nuxtVersion = dependencyVersion(pkg, "nuxt");

  if (nextVersion || nextConfig) {
    return { framework: "next", publicDir: "public", reason: "Next.js serves public/" };
  }

  if (nuxtVersion || nuxtConfig) {
    const configured = nuxtConfig ? parseNuxtPublicDir(await readText(path.join(cwd, nuxtConfig))) : undefined;
    if (configured) {
      return { framework: "nuxt", publicDir: configured, reason: `Nuxt dir.public is ${configured}/` };
    }
    if (nuxtMajor(nuxtVersion) === 2) {
      return { framework: "nuxt", publicDir: "static", reason: "Nuxt 2 default static/" };
    }
    if (!nuxtVersion && (await isDirectory(cwd, "static")) && !(await isDirectory(cwd, "public"))) {
      return { framework: "nuxt", publicDir: "static", reason: "Nuxt project already uses static/" };
    }
    return { framework: "nuxt", publicDir: "public", reason: "Nuxt serves public/" };
  }

  if (viteVersion || viteConfig) {
    const configured = viteConfig ? parseVitePublicDir(await readText(path.join(cwd, viteConfig))) : undefined;
    if (typeof configured === "string") {
      return { framework: "vite", publicDir: configured, reason: `Vite publicDir is ${configured}/` };
    }
    if (configured === false) {
      const existing = await existingPublicFolder(cwd);
      if (existing) {
        return { framework: "vite", publicDir: existing, reason: `Vite publicDir is disabled; using ${existing}/` };
      }
    }
    return { framework: "vite", publicDir: "public", reason: "Vite default public/" };
  }

  const existing = await existingPublicFolder(cwd);
  if (existing) {
    return { framework: "unknown", publicDir: existing, reason: `existing ${existing}/ directory` };
  }
  return { framework: "unknown", publicDir: "public", reason: "AgenticTrust default public/" };
}

/** Major version from a package.json range, when one is present. */
export function nuxtMajor(version: string | undefined): number | undefined {
  if (!version) return undefined;
  const match = version.match(/\d+/);
  if (!match) return undefined;
  return Number(match[0]);
}

/**
 * Vite `publicDir`. A string is the relative directory, `false` disables the
 * public folder, and `undefined` means the config does not set it.
 */
export function parseVitePublicDir(source: string): string | false | undefined {
  const text = stripComments(source);
  if (/publicDir\s*:\s*false\b/.test(text)) return false;
  const match = text.match(/publicDir\s*:\s*(['"`])([^'"`]+)\1/);
  if (!match) return undefined;
  return sanitizePublicDir(match[2]);
}

/** Nuxt `dir.public` or legacy `dir.static`, when the config sets one. */
export function parseNuxtPublicDir(source: string): string | undefined {
  const text = stripComments(source);
  const dirBlock = text.match(/dir\s*:\s*\{([^}]*)\}/);
  if (!dirBlock) return undefined;
  const pub = dirBlock[1].match(/\bpublic\s*:\s*(['"`])([^'"`]+)\1/);
  if (pub) return sanitizePublicDir(pub[2]);
  const stat = dirBlock[1].match(/\bstatic\s*:\s*(['"`])([^'"`]+)\1/);
  if (stat) return sanitizePublicDir(stat[2]);
  return undefined;
}

export function assertPublicDir(publicDir: string): string {
  const normalized = sanitizePublicDir(publicDir);
  if (!normalized) {
    throw new Error(`Unsupported public directory: ${publicDir}`);
  }
  return normalized;
}

function sanitizePublicDir(publicDir: string): string | undefined {
  let normalized = publicDir.trim().replace(/\\/g, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/+$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..") ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function dependencyVersion(pkg: PackageJson, name: string): string | undefined {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name];
}

async function readPackageJson(cwd: string): Promise<PackageJson> {
  try {
    const text = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PackageJson;
  } catch {
    return {};
  }
}

async function findConfig(cwd: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    if (await isFile(cwd, name)) return name;
  }
  return undefined;
}

async function existingPublicFolder(cwd: string): Promise<string | undefined> {
  for (const name of PUBLIC_DIR_CANDIDATES) {
    if (await isDirectory(cwd, name)) return name;
  }
  return undefined;
}

async function isDirectory(cwd: string, name: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(cwd, name));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(cwd: string, name: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(cwd, name));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}
