import { createPrivateKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  alignLlmsTxt,
  assertLlmsTxtDomain,
  createSignedDidDocument,
  hashLlmsTxt,
  normalizeDomain,
  wellKnownLlmsUrl,
  type DidDocument,
} from "@trustflow/sdk";

import type { DidKeyAlgorithm } from "./generateDidKeys.js";
import { resolveInsideRoot } from "./paths.js";

export { alignLlmsTxt };

export interface SignLlmsTxtInput {
  domain: string;
  /** Unencrypted Ed25519 or P-256 PKCS#8 PEM. Used to sign; never written by this tool. Use this or `privateKeyPath`. */
  privateKeyPem?: string;
  /** File holding the private key PEM. The key is read, used to sign, and not returned. */
  privateKeyPath?: string;
  /** llms.txt body. Use this or `llmsTxtPath`. */
  llmsTxt?: string;
  /** UTF-8 file named `llms.txt` to read when `llmsTxt` is omitted. */
  llmsTxtPath?: string;
  /** When set, `privateKeyPath`, `llmsTxtPath`, and `outputDir` must resolve inside this directory. */
  rootDir?: string;
  /**
   * When set, write public artifacts only:
   * `llms.txt`, `.well-known/llms.txt`, and `.well-known/did.json`.
   * The private key is not written.
   */
  outputDir?: string;
}

export interface SignLlmsTxtResult {
  domain: string;
  did: string;
  algorithm: DidKeyAlgorithm;
  didJson: string;
  didDocument: DidDocument;
  publicKeyPem: string;
  publicKeyHash: string;
  /** Manifest to publish. Aligned so it names the same did:web as the signed document. */
  llmsTxt: string;
  artifacts: {
    "llms.txt": string;
    ".well-known/llms.txt": string;
    ".well-known/did.json": string;
  };
  guidance: string[];
  /** Absolute paths written when `outputDir` was set. Public files only. */
  written?: string[];
}

/**
 * Sign a domain's llms.txt the way `@trustflow/cli` does:
 * `createSignedDidDocument` produces the did:web JWS whose service endpoint is
 * `/.well-known/llms.txt`. The manifest is updated so it names that same DID.
 * The private key is an input only.
 */
export async function signLlmsTxt(input: SignLlmsTxtInput): Promise<SignLlmsTxtResult> {
  const domain = normalizeDomain(input.domain);
  const privateKeyPem = await readPrivateKey(input);
  const algorithm = algorithmOfPrivateKey(privateKeyPem);
  const source = await readLlmsSource(input);
  assertLlmsTxtDomain(source, domain);
  const llmsTxt = alignLlmsTxt(source, domain);

  const identity = await createSignedDidDocument({
    domain,
    privateKeyPem,
    llmsTxtSha256: hashLlmsTxt(llmsTxt),
    services: [
      {
        id: `did:web:${domain}#llms`,
        type: "LinkedDomains",
        serviceEndpoint: wellKnownLlmsUrl(domain),
      },
    ],
  });
  const didJson = `${JSON.stringify(identity.did, null, 2)}\n`;
  if (didJson.includes("PRIVATE KEY") || llmsTxt.includes("PRIVATE KEY")) {
    throw new Error("Refusing to return signed artifacts that contain a private key");
  }

  const guidance = [
    `Signed did:web for ${domain} with @trustflow/sdk createSignedDidDocument (${algorithm}).`,
    "The did:web JWS is the Trustflow signature for this llms.txt. Its service endpoint is /.well-known/llms.txt.",
    "Publish llms.txt at the site root and the same body at /.well-known/llms.txt.",
    `Publish did.json at /.well-known/did.json (${identity.did.id}). It contains the public key only.`,
    "The private key was used to sign. It was not written and is not in this result.",
    "Register the domain with Trustflow Systems: POST https://api.trustflow.systems/v1/register (trustflow init or trustflow sign).",
  ];

  const result: SignLlmsTxtResult = {
    domain,
    did: identity.did.id,
    algorithm,
    didJson,
    didDocument: identity.did,
    publicKeyPem: identity.publicKeyPem,
    publicKeyHash: identity.publicKeyHash,
    llmsTxt,
    artifacts: {
      "llms.txt": llmsTxt,
      ".well-known/llms.txt": llmsTxt,
      ".well-known/did.json": didJson,
    },
    guidance,
  };

  const outputDir = input.outputDir?.trim();
  if (outputDir) {
    const target = input.rootDir ? resolveInsideRoot(input.rootDir, outputDir, "outputDir") : outputDir;
    result.written = await writePublicArtifacts(target, llmsTxt, didJson);
  }
  return result;
}

function resolvePath(input: SignLlmsTxtInput, target: string, label: string): string {
  return input.rootDir ? resolveInsideRoot(input.rootDir, target, label) : path.resolve(target);
}

async function readPrivateKey(input: SignLlmsTxtInput): Promise<string> {
  const inline = input.privateKeyPem?.trim();
  if (inline) return inline;
  const keyPath = input.privateKeyPath?.trim();
  if (!keyPath) {
    throw new Error("privateKeyPath (or privateKeyPem) is required (Ed25519 or P-256 PKCS#8). It is not written to disk.");
  }
  const full = resolvePath(input, keyPath, "privateKeyPath");
  try {
    const pem = (await readFile(full, "utf8")).trim();
    if (pem) return pem;
  } catch {
    // reported below without echoing file contents
  }
  throw new Error(`Could not read a private key PEM at ${full}.`);
}

async function readLlmsSource(input: SignLlmsTxtInput): Promise<string> {
  const inline = input.llmsTxt;
  if (typeof inline === "string") {
    if (!inline.trim()) throw new Error("llmsTxt is empty. Pass the manifest body or llmsTxtPath.");
    return inline;
  }
  const filePath = input.llmsTxtPath?.trim();
  if (!filePath) {
    throw new Error("Provide llmsTxt (the file body) or llmsTxtPath.");
  }
  const full = resolvePath(input, filePath, "llmsTxtPath");
  if (path.basename(full).toLowerCase() !== "llms.txt") {
    throw new Error(`llmsTxtPath must name an llms.txt file: ${filePath}`);
  }
  try {
    return await readFile(full, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "read failed";
    throw new Error(`Could not read llms.txt at ${full}: ${message}`);
  }
}

function algorithmOfPrivateKey(pem: string): DidKeyAlgorithm {
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new Error("Private key PEM could not be read. Expected an unencrypted Ed25519 or P-256 key (PKCS#8).");
  }
  if (key.asymmetricKeyType === "ed25519") return "Ed25519";
  if (key.asymmetricKeyType === "ec") {
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve === "prime256v1" || curve === "P-256") return "ES256";
    throw new Error("EC private key must be P-256 (ES256).");
  }
  throw new Error("Private key must be Ed25519 or P-256 (ES256).");
}

async function writePublicArtifacts(outputDir: string, llmsTxt: string, didJson: string): Promise<string[]> {
  const root = path.resolve(outputDir);
  const files: Array<[string, string]> = [
    ["llms.txt", llmsTxt],
    [".well-known/llms.txt", llmsTxt],
    [".well-known/did.json", didJson],
  ];
  const written: string[] = [];
  for (const [relative, contents] of files) {
    const full = path.resolve(root, relative);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside outputDir: ${relative}`);
    }
    if (contents.includes("PRIVATE KEY")) {
      throw new Error(`Refusing to write a private key to ${relative}`);
    }
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents, "utf8");
    written.push(full);
  }
  return written;
}
