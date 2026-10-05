import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { hashPublicKeyPem, normalizeDomain, publicKeyPemFromPrivate } from "@trustflow/sdk";
import { resolveInsideRoot } from "./paths.js";

export type DidKeyAlgorithm = "Ed25519" | "ES256";

/** Shown next to `privateKeyPem` in every tool result. */
export const PRIVATE_KEY_SECRET_WARNING =
  "SECRET — Trustflow did:web private key (PKCS#8 PEM). Do not commit, log, or paste this value. Sign the did.json with sign_llms_txt.";

export interface GenerateDidKeysInput {
  domain: string;
  /** Ed25519 (default) or ES256 (P-256). */
  algorithm?: string;
  /**
   * When set, write the private key PEM to this new file (mode 0600). An existing file is
   * never replaced. Omitted means the key is returned only and never written.
   */
  privateKeyPath?: string;
  /** When set, `privateKeyPath` must resolve inside this directory. */
  rootDir?: string;
  /**
   * Include `privateKeyPem` in the result. Default true. The MCP tool passes false so the key
   * never enters a model context, and requires `privateKeyPath` instead.
   */
  returnPrivateKey?: boolean;
}

export interface GenerateDidKeysResult {
  domain: string;
  /** `did:web` identifier. This tool does not return a signed document. */
  did: string;
  algorithm: DidKeyAlgorithm;
  publicKeyPem: string;
  publicKeyHash: string;
  /** SECRET. Unencrypted PKCS#8 PEM. Absent when `returnPrivateKey` is false. */
  privateKeyPem?: string;
  secret: {
    label: "SECRET";
    field: "privateKeyPem";
    warning: string;
    writtenTo?: string;
  };
}

export function parseDidKeyAlgorithm(value: string | undefined): DidKeyAlgorithm {
  const raw = (value ?? "").trim();
  if (!raw || /^ed25519$/i.test(raw) || /^eddsa$/i.test(raw)) return "Ed25519";
  if (/^es256$/i.test(raw) || /^p-?256$/i.test(raw)) return "ES256";
  throw new Error('algorithm must be "Ed25519" (default) or "ES256" (P-256).');
}

/**
 * Generate a did:web key pair only. Signing a document is `sign_llms_txt`.
 */
export async function generateDidKeys(input: GenerateDidKeysInput): Promise<GenerateDidKeysResult> {
  const domain = normalizeDomain(input.domain);
  const algorithm = parseDidKeyAlgorithm(input.algorithm);
  const privatePem = algorithm === "ES256" ? generateP256PrivateKeyPem() : generateEd25519PrivateKeyPem();
  const publicKeyPem = publicKeyPemFromPrivate(privatePem);
  const publicKeyHash = hashPublicKeyPem(publicKeyPem);

  const returnPrivateKey = input.returnPrivateKey !== false;
  let writtenTo: string | undefined;
  const requestedPath = input.privateKeyPath?.trim();
  if (!returnPrivateKey && !requestedPath) {
    throw new Error("privateKeyPath is required. The private key is written there and is not returned.");
  }
  if (requestedPath) {
    const target = input.rootDir
      ? resolveInsideRoot(input.rootDir, requestedPath, "privateKeyPath")
      : path.resolve(requestedPath);
    writtenTo = await writeSecretPem(target, privatePem);
  }

  return {
    domain,
    did: `did:web:${domain}`,
    algorithm,
    publicKeyPem,
    publicKeyHash,
    ...(returnPrivateKey ? { privateKeyPem: privatePem } : {}),
    secret: {
      label: "SECRET",
      field: "privateKeyPem",
      warning: PRIVATE_KEY_SECRET_WARNING,
      ...(writtenTo ? { writtenTo } : {}),
    },
  };
}

function generateEd25519PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  const exported = privateKey.export({ type: "pkcs8", format: "pem" });
  return typeof exported === "string" ? exported : exported.toString("utf8");
}

function generateP256PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const exported = privateKey.export({ type: "pkcs8", format: "pem" });
  return typeof exported === "string" ? exported : exported.toString("utf8");
}

async function writeSecretPem(full: string, pem: string): Promise<string> {
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  const body = pem.endsWith("\n") ? pem : `${pem}\n`;
  try {
    await writeFile(full, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${full} already exists. The existing key was not replaced. Choose a new privateKeyPath.`);
    }
    throw err;
  }
  await chmod(full, 0o600);
  return full;
}
