import { promises as fs } from "node:fs";
import path from "node:path";
import { createSignedDidDocument, normalizeDomain } from "@trustflow/sdk";
import { confirmRegistration, resolveTrustflowApiBase, TrustflowApiError } from "./api.js";
import { renderBadge } from "./badge.js";
import { detectProjectLayout, directoryExists, shouldMirrorPublishedFiles } from "./framework.js";
import { parseLlms, parseServiceList, renderLlms } from "./llms.js";
import {
  ensureGitignore,
  gitignoreNotice,
  writePrivateKey,
  writePublicKey,
  writePublishedFile,
} from "./project.js";
import { maskForGitHubActions, redactSecrets } from "./redact.js";
import { registerAndStore } from "./registerFlow.js";
import { parseVerificationType } from "./verificationType.js";

const DEFAULT_DESCRIPTION = "AI-discoverable business services";

export interface SignOptions {
  cwd: string;
  domain?: string;
  name?: string;
  description?: string;
  services?: string;
  verificationType?: string;
  apiUrl?: string;
  envApiUrl?: string;
  /** Ed25519 or P-256 private key PEM. Never written to logs. */
  privateKeyPem?: string;
  dryRun: boolean;
  confirm: boolean;
  requireLive: boolean;
  fetch: typeof fetch;
  log: (line?: string) => void;
  githubOutput?: string;
  githubSummary?: string;
}

export async function runGithubSign(options: SignOptions): Promise<number> {
  const secrets: string[] = [];
  if (options.privateKeyPem?.trim()) {
    secrets.push(options.privateKeyPem);
    maskForGitHubActions(options.privateKeyPem);
  }
  const log = (line?: string) => options.log(redactSecrets(line ?? "", secrets));

  try {
    return await signDomain(options, secrets, log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(redactSecrets(message, secrets));
    return 1;
  }
}

async function signDomain(
  options: SignOptions,
  secrets: string[],
  log: (line?: string) => void
): Promise<number> {
  const domainInput = options.domain?.trim() || (options.dryRun ? "example.invalid" : "");
  if (!domainInput) {
    throw new Error("Domain is required. Set repository variable AGENTIC_TRUST_DOMAIN or pass --domain.");
  }
  const domain = normalizeDomain(domainInput);
  const verificationType = parseVerificationType(options.verificationType);

  const layout = await detectProjectLayout(options.cwd);
  const publicDirExists = await directoryExists(options.cwd, layout.publicDir);
  const mirrorRoot = shouldMirrorPublishedFiles(layout.framework, publicDirExists);
  const rootLlmsPath = path.join(options.cwd, "llms.txt");
  const existingText = await readOptional(rootLlmsPath);
  const existing = existingText !== undefined ? parseLlms(existingText) : undefined;
  const services =
    options.services !== undefined && options.services.trim() !== ""
      ? parseServiceList(options.services)
      : existing?.services ?? [];
  const businessName = (options.name?.trim() || existing?.name || domain).trim();
  const description = (options.description?.trim() || existing?.description || DEFAULT_DESCRIPTION).trim();

  let llmsGenerated = false;
  if (existingText === undefined) {
    const llms = renderLlms({ name: businessName, description, domain, services });
    const llmsPaths = [
      ...(await writePublishedFile(options.cwd, layout.publicDir, "llms.txt", llms, mirrorRoot)),
      ...(await writePublishedFile(options.cwd, layout.publicDir, ".well-known/llms.txt", llms, mirrorRoot)),
    ];
    llmsGenerated = true;
    for (const file of llmsPaths) {
      log(`Wrote ${path.relative(options.cwd, file).split(path.sep).join("/")}`);
    }
  } else {
    log("Found llms.txt at repository root. Left it unchanged.");
  }

  const providedKey = options.privateKeyPem?.trim();
  if (!options.dryRun && !providedKey) {
    throw new Error(
      "AGENTIC_TRUST_PRIVATE_KEY is not set. Add the Ed25519 or P-256 private key as a repository secret. It is never printed."
    );
  }

  const identity = await createSignedDidDocument({
    domain,
    privateKeyPem: providedKey,
  });
  secrets.push(identity.privateKeyPem);
  maskForGitHubActions(identity.privateKeyPem);

  if (!providedKey) {
    log("Dry run signed with an ephemeral did:web key because AGENTIC_TRUST_PRIVATE_KEY is unset. The key is not printed.");
  } else {
    log("Signed did:web payload with the supplied private key.");
  }

  const gitignore = await ensureGitignore(options.cwd);
  log(gitignoreNotice(gitignore));
  await writePrivateKey(options.cwd, identity.privateKeyPem);
  await writePublicKey(options.cwd, identity.publicKeyPem);
  const didBody = `${JSON.stringify(identity.did, null, 2)}\n`;
  const didPaths = await writePublishedFile(
    options.cwd,
    layout.publicDir,
    ".well-known/did.json",
    didBody,
    mirrorRoot
  );
  for (const file of didPaths) {
    log(`Wrote ${path.relative(options.cwd, file).split(path.sep).join("/")}`);
  }
  log(`DID: ${identity.did.id}`);
  log(`publicKeyHash: ${identity.publicKeyHash}`);

  const apiBase = resolveTrustflowApiBase(options.apiUrl ?? options.envApiUrl);
  let live = false;

  if (options.dryRun) {
    log(`Dry run: skipped POST ${apiBase}/v1/register`);
    log("Publish llms.txt and .well-known/did.json, then rerun without dry-run to register the domain.");
    log(renderBadge(domain));
    await writeGitHubResult(options, {
      publicKeyHash: identity.publicKeyHash,
      live: "dry-run",
      llmsGenerated,
      did: identity.did.id ?? "",
    });
    return 0;
  }

  log(`Trustflow API: POST ${apiBase}/v1/register`);
  const { challenge, stored, registrationPath, challengeFile } = await registerAndStore({
    cwd: options.cwd,
    apiBase,
    fetchFn: options.fetch,
    domain,
    businessName,
    verificationType,
    did: identity.did.id ?? `did:web:${domain}`,
    publicKeyPem: identity.publicKeyPem,
    publicKeyHash: identity.publicKeyHash,
    services,
  });
  secrets.push(challenge.challengeToken);
  if (challenge.dnsRecord?.value) secrets.push(challenge.dnsRecord.value);
  maskForGitHubActions(challenge.challengeToken);
  maskForGitHubActions(challenge.dnsRecord?.value);

  log(`Saved challenge state to ${registrationPath} (gitignored). The challenge token is not printed.`);
  if (challenge.instructions) log(challenge.instructions);
  if (challenge.expiresAt) log(`Expires: ${challenge.expiresAt}`);
  if (challengeFile) {
    log(`Wrote the challenge token (no trailing newline) to ${challengeFile}`);
  }
  if (challenge.dnsRecord) {
    log(`DNS TXT name: ${challenge.dnsRecord.name}`);
    log("DNS TXT value is in .agentic-trust/registration.json and is not printed.");
  }

  if (options.confirm) {
    log(`Trustflow API: POST ${apiBase}/v1/register/confirm`);
    try {
      const result = await confirmRegistration(
        apiBase,
        {
          domain: stored.domain,
          challengeToken: challenge.challengeToken,
          did: stored.did,
          publicKeyHash: stored.publicKeyHash,
          services,
          businessName,
        },
        options.fetch
      );
      live = result.ok === true || result.isVerified === true || result.status === "VERIFIED";
      log(live ? "Registration confirmed. Domain status is verified." : "Confirm returned without a verified status.");
      if (typeof result.verifiedAt === "string") log(`verifiedAt: ${result.verifiedAt}`);
    } catch (err) {
      if (err instanceof TrustflowApiError && /domain proof failed/i.test(err.message)) {
        log("Register succeeded. Confirm is waiting until the challenge file or DNS TXT is publicly visible.");
        if (options.requireLive) {
          throw new Error("Domain is not live yet. The challenge proof was not accepted.");
        }
      } else {
        throw err;
      }
    }
  } else {
    log("Skipped POST /v1/register/confirm.");
  }

  log(renderBadge(domain));
  await writeGitHubResult(options, {
    publicKeyHash: identity.publicKeyHash,
    live: live ? "true" : "false",
    llmsGenerated,
    did: identity.did.id ?? "",
  });
  return 0;
}

async function writeGitHubResult(
  options: SignOptions,
  result: { publicKeyHash: string; live: string; llmsGenerated: boolean; did: string }
): Promise<void> {
  if (options.githubOutput) {
    const lines = [
      `public-key-hash=${result.publicKeyHash}`,
      `live=${result.live}`,
      `llms-generated=${result.llmsGenerated ? "true" : "false"}`,
      `did=${result.did}`,
      "",
    ];
    await fs.appendFile(options.githubOutput, lines.join("\n"), "utf8");
  }
  if (options.githubSummary) {
    const summary = [
      "### Trustflow sign",
      "",
      `- DID: \`${result.did}\``,
      `- publicKeyHash: \`${result.publicKeyHash}\``,
      `- llms.txt generated: ${result.llmsGenerated ? "yes" : "no"}`,
      `- live: ${result.live}`,
      "",
      "The private key is not included in this summary.",
      "",
    ].join("\n");
    await fs.appendFile(options.githubSummary, summary, "utf8");
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
