import { renderLlmsManifest, resolvePublishedLlms } from "@trustflow/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { publishedRelatives, writeProjectFile } from "./project.js";

/** Project-relative paths checked, in order, for an existing manifest. */
export const LLMS_CANDIDATES = [
  "llms.txt",
  ".well-known/llms.txt",
  "public/llms.txt",
  "public/.well-known/llms.txt",
  "static/llms.txt",
  "static/.well-known/llms.txt",
  "docs/llms.txt",
  "src/llms.txt",
] as const;

export interface LlmsManifest {
  name?: string;
  description?: string;
  domain?: string;
  services: string[];
  /** Absolute path when loaded from disk. */
  path?: string;
}

export function parseLlms(text: string): LlmsManifest {
  const lines = text.split(/\r?\n/);
  let name: string | undefined;
  let description: string | undefined;
  let domain: string | undefined;
  const services: string[] = [];
  let inServices = false;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (!name) name = line.slice(2).trim();
      inServices = false;
      continue;
    }
    if (line.startsWith("> ")) {
      if (!description) description = line.slice(2).trim();
      continue;
    }
    if (/^##\s+services\b/i.test(line)) {
      inServices = true;
      continue;
    }
    if (line.startsWith("## ")) {
      inServices = false;
      continue;
    }
    const domainMatch = /^domain:\s*(\S+)/i.exec(line.trim());
    if (domainMatch) domain = domainMatch[1];
    if (inServices && line.trim().startsWith("- ")) {
      const item = line.trim().slice(2).trim();
      if (item && item !== "(none listed)") services.push(item);
    }
  }

  return { name, description, domain, services };
}

/** Every path the CLI publishes llms.txt to for this layout. */
export function publishedLlmsTargets(publicDir: string, mirrorRoot: boolean): string[] {
  return [
    ...publishedRelatives(publicDir, "llms.txt", mirrorRoot),
    ...publishedRelatives(publicDir, ".well-known/llms.txt", mirrorRoot),
  ];
}

export interface FoundLlms extends LlmsManifest {
  /** Project-relative path the body was read from. */
  path: string;
  body: string;
}

/**
 * The llms.txt to sign. Published copies win, and they must be identical because one
 * hash signs every URL. Otherwise the first file in {@link LLMS_CANDIDATES} is used.
 */
export async function findPublishedLlms(
  cwd: string,
  publicDir: string,
  mirrorRoot: boolean
): Promise<FoundLlms | undefined> {
  const found = await resolvePublishedLlms(cwd, publishedLlmsTargets(publicDir, mirrorRoot), [...LLMS_CANDIDATES]);
  if (!found) return undefined;
  return { ...parseLlms(found.body), path: found.path, body: found.body };
}

/** Write `body` to each published llms.txt path that does not exist yet. Existing files are not touched. */
export async function publishLlms(
  cwd: string,
  publicDir: string,
  mirrorRoot: boolean,
  body: string
): Promise<string[]> {
  const written: string[] = [];
  for (const relative of publishedLlmsTargets(publicDir, mirrorRoot)) {
    try {
      if ((await fs.stat(path.resolve(cwd, relative))).isFile()) continue;
    } catch {
      // missing, write it
    }
    written.push(await writeProjectFile(cwd, relative, body));
  }
  return written;
}

export function renderLlms(input: {
  name: string;
  description: string;
  domain: string;
  services: string[];
}): string {
  return renderLlmsManifest(input);
}

export function parseServiceList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
