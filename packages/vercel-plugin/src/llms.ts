import { alignLlmsTxt, renderLlmsManifest } from "@trustflow/sdk";

/** Places an llms.txt may already live, used when the published copies do not exist yet. */
export const LLMS_CANDIDATES = [
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

export function parseServiceList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
