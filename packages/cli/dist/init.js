import { promises as fs } from "node:fs";
import { createSignedDidDocument, normalizeDomain } from "@trustflow/sdk";
import { resolveTrustflowApiBase } from "./api.js";
import { renderBadge, verifyPageUrl } from "./badge.js";
import { detectProjectLayout, directoryExists, nextMiddlewareNotice, shouldMirrorPublishedFiles, } from "./framework.js";
import { writeIdeRules } from "./ideRules.js";
import { parseServiceList, readLlms, renderLlms, } from "./llms.js";
import { ensureGitignore, ensurePublishedFile, gitignoreNotice, readKeyPair, writePrivateKey, writePublishedFile, writePublicKey, } from "./project.js";
import { DEFAULT_PROOF_BUDGET_MS, DEFAULT_PROOF_INTERVAL_MS, autoConfirm } from "./proofs.js";
import { registerAndStore } from "./registerFlow.js";
import { parseVerificationType } from "./verificationType.js";
export const PRIVATE_KEY_BACKUP_WARNING = "⚠️ Backup your .agentic-trust/private-key.pem! If lost, this domain's identity cannot be recovered or rotated.";
export async function runInit(options) {
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
    const layout = await detectProjectLayout(options.cwd);
    const publicDirExists = await directoryExists(options.cwd, layout.publicDir);
    const mirrorRoot = shouldMirrorPublishedFiles(layout.framework, publicDirExists);
    options.log(`Project: ${frameworkLabel(layout.framework)}. Publishing to ${layout.publicDir}/ (${layout.reason}).`);
    if (layout.framework === "next") {
        options.log(nextMiddlewareNotice());
    }
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
        for (const leaf of ["llms.txt", ".well-known/llms.txt"]) {
            for (const file of await writePublishedFile(options.cwd, layout.publicDir, leaf, llms, mirrorRoot)) {
                options.log(`Wrote ${file}`);
            }
        }
    }
    else {
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
        if (!existing.path)
            throw new Error("Found llms.txt has no path.");
        const existingText = await fs.readFile(existing.path, "utf8");
        for (const leaf of ["llms.txt", ".well-known/llms.txt"]) {
            for (const file of await ensurePublishedFile(options.cwd, layout.publicDir, leaf, existingText, mirrorRoot)) {
                options.log(`Wrote ${file}`);
            }
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
    }
    else {
        await writePrivateKey(options.cwd, identity.privateKeyPem);
        await writePublicKey(options.cwd, identity.publicKeyPem);
        options.log("Generated did:web keypair in .agentic-trust/ (gitignored). Do not commit private-key.pem.");
    }
    const didId = identity.did.id ?? `did:web:${normalizedDomain}`;
    const didBody = `${JSON.stringify(identity.did, null, 2)}\n`;
    for (const didPath of await writePublishedFile(options.cwd, layout.publicDir, ".well-known/did.json", didBody, mirrorRoot)) {
        options.log(`Wrote ${didPath}`);
    }
    options.log(`DID: ${didId}`);
    options.log(`publicKeyHash: ${identity.publicKeyHash}`);
    if (!name || !description) {
        throw new Error("Site name and description are required.");
    }
    await writeIdeRulesIfEnabled(options, layout.publicDir);
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
            did: didId,
            publicKeyPem: identity.publicKeyPem,
            publicKeyHash: identity.publicKeyHash,
            services,
            publicDir: layout.publicDir,
            mirrorRoot,
        });
        options.log(`Saved challenge state to ${registrationPath} (gitignored).`);
        if (challengeFile)
            options.log(`Wrote ${challengeFile}`);
        if (challenge.expiresAt)
            options.log(`Challenge expires: ${challenge.expiresAt}`);
        if (stored.verificationType === "DNS_TXT" && challenge.dnsRecord) {
            options.log(`DNS TXT name: ${challenge.dnsRecord.name}`);
            options.log(`DNS TXT value: ${challenge.dnsRecord.value}`);
        }
        options.log("Keep .agentic-trust/ out of git. It holds the private key and challenge token.");
        if (!options.autoConfirm) {
            options.log("Skipped auto-confirm (--no-auto-confirm).");
            options.log(`Verify: ${verifyPageUrl(normalizedDomain)}`);
            printBadge(options.log, normalizedDomain);
            return finishInit(options, 0);
        }
        options.log(`Trustflow API: POST ${apiBase}/v1/register/confirm`);
        const confirmed = await autoConfirm({
            apiBase,
            fetchFn: options.fetch,
            domain: stored.domain,
            didId,
            publicKeyPem: identity.publicKeyPem,
            publicKeyHash: identity.publicKeyHash,
            businessName: name,
            services,
            verificationType: stored.verificationType,
            challengeToken: stored.challengeToken,
            challengeUrl: stored.challengePath,
            dnsRecord: stored.dnsRecord,
            budgetMs: options.proofBudgetMs ?? DEFAULT_PROOF_BUDGET_MS,
            intervalMs: options.proofIntervalMs ?? DEFAULT_PROOF_INTERVAL_MS,
            sleep: options.sleep,
            now: options.now,
            log: options.log,
        });
        options.log(`Verify: ${verifyPageUrl(normalizedDomain)}`);
        printBadge(options.log, normalizedDomain);
        return finishInit(options, confirmed.code);
    }
    options.log("Skipped Trustflow registration (--skip-register).");
    options.log(`Publish ${layout.publicDir}/.well-known/did.json and ${layout.publicDir}/llms.txt on the domain (HTTPS).`);
    options.log("Keep .agentic-trust/ out of git. It holds the private key.");
    options.log(`Verify: ${verifyPageUrl(normalizedDomain)}`);
    printBadge(options.log, normalizedDomain);
    return finishInit(options, 0);
}
function finishInit(options, code) {
    if (code === 0)
        options.log(PRIVATE_KEY_BACKUP_WARNING);
    return code;
}
function frameworkLabel(framework) {
    if (framework === "next")
        return "Next.js";
    if (framework === "vite")
        return "Vite";
    if (framework === "nuxt")
        return "Nuxt";
    return "unknown framework";
}
async function writeIdeRulesIfEnabled(options, publicDir) {
    if (!options.ideRules) {
        options.log("Skipped IDE rules (--no-ide-rules).");
        return;
    }
    const written = await writeIdeRules(options.cwd, publicDir);
    options.log(`Wrote ${written.cursorrules}`);
    options.log(`Wrote ${written.mdc}`);
}
function printBadge(log, domain) {
    log("");
    log("Embeddable badge:");
    log(renderBadge(domain));
    log("");
}
async function requireValue(input) {
    const preset = input.preset?.trim();
    if (preset)
        return preset;
    if (!input.interactive) {
        throw new Error(`${input.label} is required. ${input.missing}`);
    }
    const answered = (await input.prompt(input.label)).trim();
    if (!answered)
        throw new Error(`${input.label} is required.`);
    return answered;
}
//# sourceMappingURL=init.js.map