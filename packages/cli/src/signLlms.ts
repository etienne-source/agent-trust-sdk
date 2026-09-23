import { promises as fs } from "node:fs";
import path from "node:path";
import { createSignedDidDocument, normalizeDomain, type DidDocument } from "@trustflow/sdk";
import { detectProjectLayout, nextMiddlewareNotice } from "./framework.js";
import { readLlms } from "./llms.js";
import { readKeyPair } from "./project.js";

export interface SignLlmsOptions {
  cwd: string;
  log: (line?: string) => void;
}

/**
 * Re-sign an existing llms.txt by rewriting `proof` on the existing did.json.
 * Does not call `/v1/register`, does not write a challenge, and does not rotate keys.
 */
export async function runSignLlms(options: SignLlmsOptions): Promise<number> {
  const llms = await readLlms(options.cwd);
  if (!llms?.path) {
    throw new Error(
      "Missing llms.txt. sign-llms signs an existing manifest and does not create one. Looked in llms.txt, .well-known/, public/, static/, docs/, and src/."
    );
  }

  const keys = await readKeyPair(options.cwd);
  if (!keys) {
    throw new Error(
      "Missing .agentic-trust/private-key.pem. sign-llms rewrites the did.json JWS with the existing key and does not generate a new one."
    );
  }

  const layout = await detectProjectLayout(options.cwd);
  const didFiles = await findDidFiles(options.cwd, layout.publicDir);
  if (didFiles.length === 0) {
    throw new Error(
      "Missing did.json. sign-llms only rewrites the JWS in an existing did.json (public/.well-known/did.json or .well-known/did.json)."
    );
  }

  const documents = await Promise.all(didFiles.map((file) => readDid(file)));
  const domain = domainFromDidId(documents[0].did.id);
  for (const document of documents.slice(1)) {
    if (domainFromDidId(document.did.id) !== domain) {
      throw new Error("did.json files name different domains. sign-llms will not rewrite a mismatched JWS.");
    }
  }
  if (llms.domain && normalizeDomain(llms.domain) !== domain) {
    throw new Error(
      `llms.txt Domain (${llms.domain}) does not match did.json (${domain}). sign-llms did not rewrite the JWS.`
    );
  }

  const identity = await createSignedDidDocument({
    domain,
    privateKeyPem: keys.privateKeyPem,
    publicKeyPem: keys.publicKeyPem,
    services: documents[0].did.service,
  });
  if (!identity.did.proof?.jws) {
    throw new Error("Signing did not produce a JWS.");
  }

  for (const document of documents) {
    const vmPem = document.did.verificationMethod?.[0]?.publicKeyPem;
    if (vmPem && normalizePem(vmPem) !== normalizePem(keys.publicKeyPem)) {
      throw new Error(
        "did.json public key does not match .agentic-trust/public-key.pem. sign-llms does not rotate keys."
      );
    }
  }

  for (const document of documents) {
    const next: DidDocument = {
      ...document.did,
      proof: identity.did.proof,
    };
    const body = `${JSON.stringify(next, null, 2)}\n`;
    if (body.includes("PRIVATE KEY")) {
      throw new Error("Refusing to write a private key into did.json.");
    }
    await fs.writeFile(document.file, body, "utf8");
    options.log(`Rewrote JWS in ${path.relative(options.cwd, document.file)}`);
  }

  options.log(`Signed existing llms.txt at ${path.relative(options.cwd, llms.path)}.`);
  options.log("Did not call POST /v1/register and did not write a challenge.");
  if (layout.framework === "next") {
    options.log(nextMiddlewareNotice());
  }
  return 0;
}

async function findDidFiles(cwd: string, publicDir: string): Promise<string[]> {
  const relatives = [
    `${publicDir}/.well-known/did.json`,
    "public/.well-known/did.json",
    "static/.well-known/did.json",
    ".well-known/did.json",
  ];
  const found: string[] = [];
  const seen = new Set<string>();
  const root = path.resolve(cwd);
  for (const relative of relatives) {
    const full = path.resolve(cwd, relative);
    if (full !== root && !full.startsWith(root + path.sep)) continue;
    if (seen.has(full)) continue;
    seen.add(full);
    try {
      const stat = await fs.stat(full);
      if (stat.isFile()) found.push(full);
    } catch {
      // candidate missing
    }
  }
  return found;
}

async function readDid(file: string): Promise<{ file: string; did: DidDocument }> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "read failed";
    throw new Error(`Missing did.json at ${file}: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`did.json is not valid JSON (${file}).`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`did.json is not a JSON object (${file}).`);
  }
  const did = parsed as DidDocument;
  if (typeof did.id !== "string" || did.id.trim() === "") {
    throw new Error(`did.json is missing an id (${file}).`);
  }
  return { file, did };
}

function domainFromDidId(id: string): string {
  if (!id.startsWith("did:web:")) {
    throw new Error(`did.json id is not did:web (${id}). sign-llms only rewrites an existing did:web JWS.`);
  }
  const host = id.slice("did:web:".length).split(":")[0];
  if (!host) throw new Error(`did.json id is not a usable did:web (${id}).`);
  return normalizeDomain(host);
}

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, "\n").trim();
}
