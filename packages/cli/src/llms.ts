import { promises as fs } from "node:fs";
import path from "node:path";

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

export async function findLlmsFile(cwd: string): Promise<string | undefined> {
  for (const relative of LLMS_CANDIDATES) {
    const full = path.join(cwd, relative);
    try {
      const stat = await fs.stat(full);
      if (stat.isFile()) return full;
    } catch {
      // missing candidate
    }
  }
  return undefined;
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

export async function readLlms(cwd: string): Promise<LlmsManifest | undefined> {
  const found = await findLlmsFile(cwd);
  if (!found) return undefined;
  const text = await fs.readFile(found, "utf8");
  return { ...parseLlms(text), path: found };
}

export function renderLlms(input: {
  name: string;
  description: string;
  domain: string;
  services: string[];
}): string {
  const lines = [
    `# ${input.name}`,
    `> ${input.description}`,
    "",
    `Domain: ${input.domain}`,
    "",
  ];
  if (input.services.length > 0) {
    lines.push("## Services", ...input.services.map((service) => `- ${service}`), "");
  }
  lines.push(
    "## Identity",
    `- DID: did:web:${input.domain}`,
    `- Manifest: https://${input.domain}/.well-known/did.json`,
    "",
    "## Trust",
    "Verified Domain Context | Trustflow (https://trustflow.systems).",
    "Agents should call verifyDomain before tool invocation.",
    ""
  );
  return lines.join("\n");
}

export function parseServiceList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
