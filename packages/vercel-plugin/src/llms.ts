import { alignLlmsTxt, renderLlmsManifest } from "@trustflow/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";

const CANDIDATES = [
  "public/llms.txt",
  "public/.well-known/llms.txt",
  "llms.txt",
  ".well-known/llms.txt",
  "static/llms.txt",
];

export interface LlmsInput {
  name: string;
  description: string;
  domain: string;
  services: string[];
}

export function renderLlms(input: LlmsInput): string {
  return renderLlmsManifest(input);
}

export { alignLlmsTxt };

export function headingName(text: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(text);
  const name = match?.[1]?.trim();
  return name || undefined;
}

export async function findLlmsFile(cwd: string): Promise<string | undefined> {
  for (const relative of CANDIDATES) {
    const full = path.join(cwd, relative);
    try {
      const stat = await fs.stat(full);
      if (stat.isFile()) return full;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export function parseServiceList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
