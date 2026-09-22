import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createSignedDidDocument, normalizeDomain, type DidDocument } from "@agentic-trust/sdk";

export type DidKeyAlgorithm = "Ed25519" | "ES256";

/** Shown next to `privateKeyPem` in every tool result. */
export const PRIVATE_KEY_SECRET_WARNING =
  "SECRET — AgenticTrust did:web private key (PKCS#8 PEM). Do not commit, log, paste into a public channel, or publish this value. Publish only did.json. This tool does not write the key unless privateKeyPath is set.";

export interface GenerateDidKeysInput {
  domain: string;
  /** Ed25519 (default) or ES256 (P-256). */
  algorithm?: string;
  /**
   * When set, write the private key PEM to this path (mode 0600).
   * Omitted means the key is returned only and never written.
   */
  privateKeyPath?: string;
}

export interface GenerateDidKeysResult {
  domain: string;
  did: string;
  algorithm: DidKeyAlgorithm;
  /** Pretty-printed did.json for `/.well-known/did.json`. Public material only. */
  didJson: string;
  didDocument: DidDocument;
  publicKeyPem: string;
  publicKeyHash: string;
  /** SECRET. Unencrypted PKCS#8 PEM. */
  privateKeyPem: string;
  secret: {
    label: "SECRET";
    field: "privateKeyPem";
    warning: string;
    writtenTo?: string;
  };
  publish: {
    didJsonPath: ".well-known/did.json";
    didJsonUrl: string;
    llmsTxtUrl: string;
  };
}

export function parseDidKeyAlgorithm(value: string | undefined): DidKeyAlgorithm {
  const raw = (value ?? "").trim();
  if (!raw || /^ed25519$/i.test(raw) || /^eddsa$/i.test(raw)) return "Ed25519";
  if (/^es256$/i.test(raw) || /^p-?256$/i.test(raw)) return "ES256";
  throw new Error('algorithm must be "Ed25519" (default) or "ES256" (P-256).');
}

/**
 * Generate a did:web key and a signed W3C document.
 * Ed25519 keys come from `@agentic-trust/sdk` `createSignedDidDocument`.
 * ES256 uses a P-256 PKCS#8 key passed into that same signer — the DID proof is not built here.
 */
export async function generateDidKeys(input: GenerateDidKeysInput): Promise<GenerateDidKeysResult> {
  const domain = normalizeDomain(input.domain);
  const algorithm = parseDidKeyAlgorithm(input.algorithm);
  const privateKeyPem = algorithm === "ES256" ? generateP256PrivateKeyPem() : undefined;
  const identity = await createSignedDidDocument({ domain, privateKeyPem });
  const didJson = `${JSON.stringify(identity.did, null, 2)}\n`;
  if (didJson.includes("PRIVATE KEY")) {
    throw new Error("Refusing to return a did.json that contains a private key");
  }

  let writtenTo: string | undefined;
  const requestedPath = input.privateKeyPath?.trim();
  if (requestedPath) {
    writtenTo = await writeSecretPem(requestedPath, identity.privateKeyPem);
  }

  return {
    domain,
    did: identity.did.id,
    algorithm,
    didJson,
    didDocument: identity.did,
    publicKeyPem: identity.publicKeyPem,
    publicKeyHash: identity.publicKeyHash,
    privateKeyPem: identity.privateKeyPem,
    secret: {
      label: "SECRET",
      field: "privateKeyPem",
      warning: PRIVATE_KEY_SECRET_WARNING,
      ...(writtenTo ? { writtenTo } : {}),
    },
    publish: {
      didJsonPath: ".well-known/did.json",
      didJsonUrl: `https://${domain}/.well-known/did.json`,
      llmsTxtUrl: `https://${domain}/.well-known/llms.txt`,
    },
  };
}

function generateP256PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const exported = privateKey.export({ type: "pkcs8", format: "pem" });
  return typeof exported === "string" ? exported : exported.toString("utf8");
}

async function writeSecretPem(filePath: string, pem: string): Promise<string> {
  const full = path.resolve(filePath);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  const body = pem.endsWith("\n") ? pem : `${pem}\n`;
  await writeFile(full, body, { encoding: "utf8", mode: 0o600 });
  await chmod(full, 0o600);
  return full;
}
