import { promises as fs } from "node:fs";
import path from "node:path";
import { createSignedDidDocument, normalizeDomain } from "@agentic-trust/sdk";
import { confirmRegistration, registerDomain, resolveTrustflowApiBase, TrustflowApiError, } from "./api.js";
import { renderBadge } from "./badge.js";
import { parseLlms, parseServiceList, renderLlms } from "./llms.js";
import { ensureGitignore, writePrivateKey, writeProjectFile, writePublicKey, writeRegistration, } from "./project.js";
import { maskForGitHubActions, redactSecrets } from "./redact.js";
const DEFAULT_DESCRIPTION = "AI-discoverable business services";
export async function runGithubSign(options) {
    const secrets = [];
    if (options.privateKeyPem?.trim()) {
        secrets.push(options.privateKeyPem);
        maskForGitHubActions(options.privateKeyPem);
    }
    const log = (line) => options.log(redactSecrets(line ?? "", secrets));
    try {
        return await signDomain(options, secrets, log);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(redactSecrets(message, secrets));
        return 1;
    }
}
async function signDomain(options, secrets, log) {
    const domainInput = options.domain?.trim() || (options.dryRun ? "example.invalid" : "");
    if (!domainInput) {
        throw new Error("Domain is required. Set repository variable AGENTIC_TRUST_DOMAIN or pass --domain.");
    }
    const domain = normalizeDomain(domainInput);
    const verificationType = parseVerificationType(options.verificationType);
    const rootLlmsPath = path.join(options.cwd, "llms.txt");
    const existingText = await readOptional(rootLlmsPath);
    const existing = existingText !== undefined ? parseLlms(existingText) : undefined;
    const services = options.services !== undefined && options.services.trim() !== ""
        ? parseServiceList(options.services)
        : existing?.services ?? [];
    const businessName = (options.name?.trim() || existing?.name || domain).trim();
    const description = (options.description?.trim() || existing?.description || DEFAULT_DESCRIPTION).trim();
    let llmsGenerated = false;
    if (existingText === undefined) {
        const llms = renderLlms({ name: businessName, description, domain, services });
        await writeProjectFile(options.cwd, "llms.txt", llms);
        await writeProjectFile(options.cwd, ".well-known/llms.txt", llms);
        llmsGenerated = true;
        log("Wrote llms.txt (standard template) and .well-known/llms.txt");
    }
    else {
        log("Found llms.txt at repository root. Left it unchanged.");
    }
    const providedKey = options.privateKeyPem?.trim();
    if (!options.dryRun && !providedKey) {
        throw new Error("AGENTIC_TRUST_PRIVATE_KEY is not set. Add the Ed25519 or P-256 private key as a repository secret. It is never printed.");
    }
    const identity = await createSignedDidDocument({
        domain,
        privateKeyPem: providedKey,
    });
    secrets.push(identity.privateKeyPem);
    maskForGitHubActions(identity.privateKeyPem);
    if (!providedKey) {
        log("Dry run signed with an ephemeral did:web key because AGENTIC_TRUST_PRIVATE_KEY is unset. The key is not printed.");
    }
    else {
        log("Signed did:web payload with the supplied private key.");
    }
    const gitignore = await ensureGitignore(options.cwd);
    log(gitignore === "updated"
        ? "Updated .gitignore to exclude .agentic-trust/ (private did:web key)."
        : ".gitignore already excludes .agentic-trust/.");
    await writePrivateKey(options.cwd, identity.privateKeyPem);
    await writePublicKey(options.cwd, identity.publicKeyPem);
    const didPath = await writeProjectFile(options.cwd, ".well-known/did.json", `${JSON.stringify(identity.did, null, 2)}\n`);
    log(`Wrote ${didPath}`);
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
    const challenge = await registerDomain(apiBase, {
        domain,
        businessName,
        verificationType,
        did: identity.did.id,
        publicKeyPem: identity.publicKeyPem,
        publicKeyHash: identity.publicKeyHash,
        manifestUrl: `https://${domain}/.well-known/did.json`,
        services,
    }, options.fetch);
    secrets.push(challenge.challengeToken);
    if (challenge.dnsRecord?.value)
        secrets.push(challenge.dnsRecord.value);
    maskForGitHubActions(challenge.challengeToken);
    maskForGitHubActions(challenge.dnsRecord?.value);
    const stored = {
        domain: challenge.domain || domain,
        businessName,
        verificationType: challenge.verificationType || verificationType,
        challengeToken: challenge.challengeToken,
        challengePath: challenge.challengePath,
        dnsRecord: challenge.dnsRecord,
        instructions: challenge.instructions,
        expiresAt: challenge.expiresAt,
        tier: challenge.tier,
        did: identity.did.id ?? `did:web:${domain}`,
        publicKeyHash: identity.publicKeyHash,
        services,
        apiBase,
    };
    const registrationPath = await writeRegistration(options.cwd, stored);
    log(`Saved challenge state to ${registrationPath} (gitignored). The challenge token is not printed.`);
    if (challenge.instructions)
        log(challenge.instructions);
    if (challenge.expiresAt)
        log(`Expires: ${challenge.expiresAt}`);
    if (challenge.verificationType === "SSL_CHALLENGE" || challenge.challengePath) {
        const challengeFile = await writeProjectFile(options.cwd, ".well-known/agentic-trust-challenge.txt", challenge.challengeToken);
        log(`Wrote the challenge token (no trailing newline) to ${challengeFile}`);
    }
    if (challenge.dnsRecord) {
        log(`DNS TXT name: ${challenge.dnsRecord.name}`);
        log("DNS TXT value is in .agentic-trust/registration.json and is not printed.");
    }
    if (options.confirm) {
        log(`Trustflow API: POST ${apiBase}/v1/register/confirm`);
        try {
            const result = await confirmRegistration(apiBase, {
                domain: stored.domain,
                challengeToken: challenge.challengeToken,
                did: stored.did,
                publicKeyHash: stored.publicKeyHash,
                services,
                businessName,
            }, options.fetch);
            live = result.ok === true || result.isVerified === true || result.status === "VERIFIED";
            log(live ? "Registration confirmed. Domain status is verified." : "Confirm returned without a verified status.");
            if (typeof result.verifiedAt === "string")
                log(`verifiedAt: ${result.verifiedAt}`);
        }
        catch (err) {
            if (err instanceof TrustflowApiError && /domain proof failed/i.test(err.message)) {
                log("Register succeeded. Confirm is waiting until the challenge file or DNS TXT is publicly visible.");
                if (options.requireLive) {
                    throw new Error("Domain is not live yet. The challenge proof was not accepted.");
                }
            }
            else {
                throw err;
            }
        }
    }
    else {
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
async function writeGitHubResult(options, result) {
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
            "### AgenticTrust sign",
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
async function readOptional(file) {
    try {
        return await fs.readFile(file, "utf8");
    }
    catch {
        return undefined;
    }
}
function parseVerificationType(value) {
    if (!value || value === "SSL_CHALLENGE")
        return "SSL_CHALLENGE";
    if (value === "DNS_TXT")
        return "DNS_TXT";
    throw new Error("verification type must be SSL_CHALLENGE or DNS_TXT");
}
//# sourceMappingURL=sign.js.map