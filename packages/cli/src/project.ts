import { promises as fs } from "node:fs";
import path from "node:path";
import type { VerificationType } from "./api.js";
import { assertPublicDir } from "./framework.js";

export const SECRETS_DIR = ".agentic-trust";

const GITIGNORE_BLOCK = [
  "# Trustflow local secrets (did:web private key). Safe to commit .well-known/did.json.",
  ".agentic-trust/",
  "",
].join("\n");

export interface StoredRegistration {
  domain: string;
  businessName: string;
  verificationType: VerificationType;
  challengeToken: string;
  challengePath?: string;
  dnsRecord?: { name: string; value: string };
  instructions: string;
  expiresAt: string;
  tier?: string;
  did: string;
  publicKeyHash: string;
  services: string[];
  apiBase: string;
}

export function secretsDir(cwd: string): string {
  return path.join(cwd, SECRETS_DIR);
}

export async function ensureGitignore(cwd: string): Promise<"updated" | "present"> {
  const file = path.join(cwd, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(file, "utf8");
  } catch {
    current = "";
  }
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(".agentic-trust/") || lines.includes(".agentic-trust")) {
    return "present";
  }
  const prefix = current.length === 0 ? "" : current.endsWith("\n") ? current : `${current}\n`;
  const spacer = prefix.length === 0 ? "" : "\n";
  await fs.writeFile(file, `${prefix}${spacer}${GITIGNORE_BLOCK}`, "utf8");
  return "updated";
}

export async function writePrivateKey(cwd: string, pem: string): Promise<string> {
  const dir = secretsDir(cwd);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "private-key.pem");
  await fs.writeFile(file, pem.endsWith("\n") ? pem : `${pem}\n`, "utf8");
  await fs.chmod(file, 0o600);
  return file;
}

export async function writePublicKey(cwd: string, pem: string): Promise<string> {
  const dir = secretsDir(cwd);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "public-key.pem");
  await fs.writeFile(file, pem.endsWith("\n") ? pem : `${pem}\n`, "utf8");
  return file;
}

export async function readKeyPair(
  cwd: string
): Promise<{ privateKeyPem: string; publicKeyPem: string } | undefined> {
  const dir = secretsDir(cwd);
  try {
    const [privateKeyPem, publicKeyPem] = await Promise.all([
      fs.readFile(path.join(dir, "private-key.pem"), "utf8"),
      fs.readFile(path.join(dir, "public-key.pem"), "utf8"),
    ]);
    if (!privateKeyPem.trim() || !publicKeyPem.trim()) return undefined;
    return { privateKeyPem, publicKeyPem };
  } catch {
    return undefined;
  }
}

export async function writeRegistration(cwd: string, registration: StoredRegistration): Promise<string> {
  const dir = secretsDir(cwd);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "registration.json");
  await fs.writeFile(file, `${JSON.stringify(registration, null, 2)}\n`, "utf8");
  await fs.chmod(file, 0o600);
  return file;
}

export async function readRegistration(cwd: string): Promise<StoredRegistration | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path.join(secretsDir(cwd), "registration.json"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(".agentic-trust/registration.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(".agentic-trust/registration.json is not a JSON object");
  }
  return parsed as StoredRegistration;
}

export function gitignoreNotice(status: "updated" | "present"): string {
  return status === "updated"
    ? "Updated .gitignore to exclude .agentic-trust/ (private did:web key)."
    : ".gitignore already excludes .agentic-trust/.";
}

export async function writeDidDocument(cwd: string, did: object): Promise<string> {
  return writeProjectFile(cwd, ".well-known/did.json", `${JSON.stringify(did, null, 2)}\n`);
}

/**
 * Paths for one site asset. The framework public directory is first.
 * `mirrorRoot` also writes the workspace-root copy. Next-like projects pass false.
 */
export function publishedRelatives(publicDir: string, leaf: string, mirrorRoot = true): string[] {
  const dir = assertPublicDir(publicDir);
  const nested = `${dir}/${leaf}`.replace(/\/{2,}/g, "/");
  if (nested === leaf) return [leaf];
  if (!mirrorRoot) return [nested];
  return [nested, leaf];
}

export async function writePublishedFile(
  cwd: string,
  publicDir: string,
  leaf: string,
  contents: string,
  mirrorRoot = true
): Promise<string[]> {
  const written: string[] = [];
  for (const relative of publishedRelatives(publicDir, leaf, mirrorRoot)) {
    written.push(await writeProjectFile(cwd, relative, contents));
  }
  return written;
}

/** Write `contents` only where that relative path is not already a file. */
export async function ensurePublishedFile(
  cwd: string,
  publicDir: string,
  leaf: string,
  contents: string,
  mirrorRoot = true
): Promise<string[]> {
  const written: string[] = [];
  for (const relative of publishedRelatives(publicDir, leaf, mirrorRoot)) {
    const full = path.resolve(cwd, relative);
    try {
      const stat = await fs.stat(full);
      if (stat.isFile()) continue;
    } catch {
      // missing, write it
    }
    written.push(await writeProjectFile(cwd, relative, contents));
  }
  return written;
}

export async function writeProjectFile(cwd: string, relative: string, contents: string): Promise<string> {
  const full = path.resolve(cwd, relative);
  const root = path.resolve(cwd);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside the project directory: ${relative}`);
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents, "utf8");
  return full;
}
