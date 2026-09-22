import { createSignedDidDocument, normalizeDomain } from "@agentic-trust/sdk";
import { resolveTrustflowApiBase } from "./api.js";
import { renderBadge } from "./badge.js";
import {
  parseServiceList,
  readLlms,
  renderLlms,
} from "./llms.js";
import {
  ensureGitignore,
  gitignoreNotice,
  readKeyPair,
  writeDidDocument,
  writePrivateKey,
  writeProjectFile,
  writePublicKey,
} from "./project.js";
import { registerAndStore } from "./registerFlow.js";
import { parseVerificationType } from "./verificationType.js";

export interface InitOptions {
  cwd: string;
  domain?: string;
  name?: string;
  description?: string;
  services?: string;
  verificationType?: string;
  apiUrl?: string;
  envApiUrl?: string;
  nonInteractive: boolean;
  stdinIsTTY: boolean;
  confirm: boolean;
  skipRegister: boolean;
  forceKeys: boolean;
  fetch: typeof fetch;
  prompt: (question: string) => Promise<string>;
  log: (line?: string) => void;
}

export async function runInit(options: InitOptions): Promise<number> {
  const interactive = !options.nonInteractive && options.stdinIsTTY;
  const existing = await readLlms(options.cwd);

  const domain = await requireValue({
    preset: options.domain ?? existing?.domain,
    label: "Domain (example.com)",
    interactive,
    prompt: options.prompt,
    missing: "Pass --domain or include a `Domain:` line in llms.txt.",
  });
  const normalizedDomain = normalizeDomain(domain);

  let name = options.name ?? existing?.name;
  let description = options.description ?? existing?.description;
  let services = options.services !== undefined ? parseServiceList(options.services) : existing?.services ?? [];

  if (!existing) {
    name = await requireValue({
      preset: name,
      label: "Site name",
      interactive,
      prompt: options.prompt,
      missing: "Pass --name to generate llms.txt without a prompt.",
    });
    description = await requireValue({
      preset: description,
      label: "Description",
      interactive,
      prompt: options.prompt,
      missing: "Pass --description to generate llms.txt without a prompt.",
    });
    if (options.services === undefined) {
      if (interactive) {
        const answered = (await options.prompt("Services (optional, comma-separated)")).trim();
        services = parseServiceList(answered);
      }
    }
    const llms = renderLlms({
      name,
      description,
      domain: normalizedDomain,
      services,
    });
    const rootFile = await writeProjectFile(options.cwd, "llms.txt", llms);
    const wellKnown = await writeProjectFile(options.cwd, ".well-known/llms.txt", llms);
    options.log(`Wrote ${rootFile}`);
    options.log(`Wrote ${wellKnown}`);
  } else {
    options.log(`Found llms.txt at ${existing.path}`);
    if (!name || !description) {
      name = await requireValue({
        preset: name,
        label: "Site name",
        interactive,
        prompt: options.prompt,
        missing: "llms.txt has no site name. Pass --name.",
      });
      description = await requireValue({
        preset: description,
        label: "Description",
        interactive,
        prompt: options.prompt,
        missing: "llms.txt has no description. Pass --description.",
      });
    }
  }

  const verificationType = parseVerificationType(options.verificationType);
  const gitignore = await ensureGitignore(options.cwd);
  options.log(gitignoreNotice(gitignore));

  const existingKeys = options.forceKeys ? undefined : await readKeyPair(options.cwd);
  const identity = await createSignedDidDocument({
    domain: normalizedDomain,
    privateKeyPem: existingKeys?.privateKeyPem,
    publicKeyPem: existingKeys?.publicKeyPem,
  });
  if (existingKeys) {
    options.log("Reused did:web keypair in .agentic-trust/.");
  } else {
    await writePrivateKey(options.cwd, identity.privateKeyPem);
    await writePublicKey(options.cwd, identity.publicKeyPem);
    options.log("Generated did:web keypair in .agentic-trust/ (gitignored). Do not commit private-key.pem.");
  }

  const didPath = await writeDidDocument(options.cwd, identity.did);
  options.log(`Wrote ${didPath}`);
  options.log(`DID: ${identity.did.id}`);
  options.log(`publicKeyHash: ${identity.publicKeyHash}`);

  if (!name || !description) {
    throw new Error("Site name and description are required.");
  }

  if (!options.skipRegister) {
    const apiBase = resolveTrustflowApiBase(options.apiUrl ?? options.envApiUrl);
    options.log(`Trustflow API: POST ${apiBase}/v1/register`);
    const { challenge, stored, registrationPath, challengeFile } = await registerAndStore({
      cwd: options.cwd,
      apiBase,
      fetchFn: options.fetch,
      domain: normalizedDomain,
      businessName: name,
      verificationType,
      did: identity.did.id,
      publicKeyPem: identity.publicKeyPem,
      publicKeyHash: identity.publicKeyHash,
      services,
    });
    options.log(`Saved challenge state to ${registrationPath} (gitignored).`);
    options.log("");
    options.log(challenge.instructions);
    if (challenge.expiresAt) options.log(`Expires: ${challenge.expiresAt}`);
    if (challengeFile) {
      options.log(`Wrote the challenge token (no trailing newline) to ${challengeFile}`);
      options.log("Deploy that file so the URL in the instructions returns the token as the exact response body, then confirm.");
    }
    if (challenge.dnsRecord) {
      options.log(`DNS TXT name: ${challenge.dnsRecord.name}`);
      options.log(`DNS TXT value: ${challenge.dnsRecord.value}`);
    }
    options.log("Confirm with: agentic-trust confirm");
    options.log("Next steps:");
    options.log(
      stored.verificationType === "DNS_TXT"
        ? "- Publish .well-known/did.json and llms.txt, and create the DNS TXT record above."
        : "- Publish .well-known/did.json, llms.txt, and .well-known/agentic-trust-challenge.txt on the domain (HTTPS)."
    );
    options.log("- Keep .agentic-trust/ out of git. It holds the private key and challenge token.");
    printBadge(options.log, normalizedDomain);

    if (options.confirm) {
      const { runConfirm } = await import("./confirm.js");
      return runConfirm({
        cwd: options.cwd,
        fetch: options.fetch,
        log: options.log,
        apiUrl: apiBase,
        printBadge: false,
      });
    }
    return 0;
  }

  options.log("Skipped Trustflow registration (--skip-register).");
  options.log("Next steps:");
  options.log("- Publish .well-known/did.json and llms.txt on the domain (HTTPS).");
  options.log("- Keep .agentic-trust/ out of git. It holds the private key.");
  options.log("- Register later with: agentic-trust init");
  printBadge(options.log, normalizedDomain);
  return 0;
}

function printBadge(log: (line?: string) => void, domain: string): void {
  log("");
  log("Embeddable badge:");
  log(renderBadge(domain));
  log("");
}

async function requireValue(input: {
  preset?: string;
  label: string;
  interactive: boolean;
  prompt: (question: string) => Promise<string>;
  missing: string;
}): Promise<string> {
  const preset = input.preset?.trim();
  if (preset) return preset;
  if (!input.interactive) {
    throw new Error(`${input.label} is required. ${input.missing}`);
  }
  const answered = (await input.prompt(input.label)).trim();
  if (!answered) throw new Error(`${input.label} is required.`);
  return answered;
}
