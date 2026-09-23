import { createPrivateKey } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeDomain, signBuildArtifacts, wellKnownLlmsUrl } from "@trustflow/sdk";
import { alignLlmsTxt, findLlmsFile, headingName, parseServiceList, renderLlms } from "./llms.js";
export const AGENTIC_TRUST_VERCEL_BIN = "agentic-trust-vercel";
const NEXT_CONFIGS = [
    "next.config.ts",
    "next.config.mts",
    "next.config.mjs",
    "next.config.js",
    "next.config.cjs",
];
const GITIGNORE_LINES = [".agentic-trust/", "*.pem"];
export function agenticTrustBuildCommand(appBuild = "next build") {
    return `${AGENTIC_TRUST_VERCEL_BIN} && ${appBuild}`;
}
/**
 * Merge a `vercel.json` object so the build signs identity files before the app build.
 * The private key is not part of this object. Set it as a Vercel environment secret.
 */
export function withAgenticTrustVercelConfig(config, appBuild = "next build") {
    const existing = typeof config.buildCommand === "string" ? config.buildCommand.trim() : "";
    let buildCommand = agenticTrustBuildCommand(appBuild);
    if (existing.includes(AGENTIC_TRUST_VERCEL_BIN)) {
        buildCommand = existing;
    }
    else if (existing) {
        buildCommand = `${AGENTIC_TRUST_VERCEL_BIN} && ${existing}`;
    }
    return { ...config, buildCommand };
}
function envValue(env, name) {
    const value = env[name];
    return value && value.trim() ? value.trim() : undefined;
}
function resolveDomain(options, env) {
    const raw = options.domain?.trim() ||
        envValue(env, "AGENTIC_TRUST_DOMAIN") ||
        envValue(env, "VERCEL_PROJECT_PRODUCTION_URL") ||
        envValue(env, "VERCEL_URL");
    if (!raw) {
        throw new Error("AGENTIC_TRUST_DOMAIN is not set. Add the hostname as a Vercel environment variable. This build does not prompt.");
    }
    return normalizeDomain(raw);
}
function assertPrivateKey(pem) {
    let key;
    try {
        key = createPrivateKey(pem);
    }
    catch {
        throw new Error("AGENTIC_TRUST_PRIVATE_KEY could not be read. Expected an unencrypted Ed25519 or P-256 PKCS#8 PEM. It is not written.");
    }
    if (key.asymmetricKeyType === "ed25519")
        return "Ed25519";
    if (key.asymmetricKeyType === "ec") {
        const curve = key.asymmetricKeyDetails?.namedCurve;
        if (curve === "prime256v1" || curve === "P-256")
            return "ES256";
    }
    throw new Error("AGENTIC_TRUST_PRIVATE_KEY must be Ed25519 or P-256 (ES256). It is not written.");
}
function assertPublic(relative, contents, secret) {
    if (contents.includes(secret) || contents.includes("BEGIN PRIVATE KEY") || contents.includes("BEGIN OPENSSH PRIVATE KEY")) {
        throw new Error(`Refusing to publish a private key in ${relative}`);
    }
}
async function pathExists(filePath, kind) {
    try {
        const stat = await fs.stat(filePath);
        return kind === "dir" ? stat.isDirectory() : stat.isFile();
    }
    catch {
        return false;
    }
}
async function defaultOutDir(cwd) {
    if (await pathExists(path.join(cwd, "public"), "dir"))
        return "public";
    for (const name of NEXT_CONFIGS) {
        if (await pathExists(path.join(cwd, name), "file"))
            return "public";
    }
    return ".";
}
async function ensureGitignore(cwd) {
    const file = path.join(cwd, ".gitignore");
    let current = "";
    try {
        current = await fs.readFile(file, "utf8");
    }
    catch {
        current = "";
    }
    const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
    const missing = GITIGNORE_LINES.filter((line) => !lines.has(line));
    if (missing.length === 0)
        return;
    const prefix = current.length === 0 ? "" : current.endsWith("\n") ? current : `${current}\n`;
    const block = [
        "# AgenticTrust private keys stay in the host environment. Never commit them.",
        ...missing,
        "",
    ].join("\n");
    await fs.writeFile(file, `${prefix}${prefix && !prefix.endsWith("\n\n") ? "\n" : ""}${block}`, "utf8");
}
function projectPath(cwd, relative) {
    const full = path.resolve(cwd, relative);
    const root = path.resolve(cwd);
    if (full !== root && !full.startsWith(root + path.sep)) {
        throw new Error(`Refusing to write outside the project directory: ${relative}`);
    }
    return full;
}
/**
 * Sign `llms.txt` and `.well-known/did.json` for a Vercel or Next.js build.
 * Reads `AGENTIC_TRUST_PRIVATE_KEY` from the environment. The key is not written.
 */
export async function runAgenticTrustVercelBuild(options = {}) {
    const env = options.env ?? process.env;
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const domain = resolveDomain(options, env);
    const privateKeyPem = (options.privateKeyPem ?? envValue(env, "AGENTIC_TRUST_PRIVATE_KEY") ?? "").trim();
    if (!privateKeyPem) {
        throw new Error("AGENTIC_TRUST_PRIVATE_KEY is not set. Add the Ed25519 or P-256 PEM as a Vercel sensitive environment variable. Do not commit it and do not pass it on a command line.");
    }
    const algorithm = assertPrivateKey(privateKeyPem);
    const existingPath = await findLlmsFile(cwd);
    const existing = existingPath ? await fs.readFile(existingPath, "utf8") : undefined;
    const services = parseServiceList(options.services ?? envValue(env, "AGENTIC_TRUST_SERVICES"));
    const businessName = (options.businessName?.trim() ||
        envValue(env, "AGENTIC_TRUST_BUSINESS_NAME") ||
        (existing ? headingName(existing) : undefined) ||
        domain).trim();
    const description = (options.description?.trim() ||
        envValue(env, "AGENTIC_TRUST_DESCRIPTION") ||
        "AI-discoverable business services").trim();
    const llmsGenerated = existing === undefined;
    const llmsTxt = existing
        ? alignLlmsTxt(existing, domain)
        : renderLlms({ name: businessName, description, domain, services });
    const identity = await signBuildArtifacts({
        domain,
        privateKeyPem,
        services: [
            {
                id: `did:web:${domain}#llms`,
                type: "LinkedDomains",
                serviceEndpoint: wellKnownLlmsUrl(domain),
            },
        ],
    });
    const didJson = identity.didJson;
    const outDir = options.outDir?.trim() || (await defaultOutDir(cwd));
    const relativeOut = outDir === "." ? "" : outDir.replace(/\\/g, "/").replace(/\/$/, "");
    const join = (name) => (relativeOut ? `${relativeOut}/${name}` : name);
    const files = [
        { path: join("llms.txt"), contents: llmsTxt.endsWith("\n") ? llmsTxt : `${llmsTxt}\n` },
        { path: join(".well-known/llms.txt"), contents: llmsTxt.endsWith("\n") ? llmsTxt : `${llmsTxt}\n` },
        { path: join(".well-known/did.json"), contents: didJson },
    ];
    for (const file of files)
        assertPublic(file.path, file.contents, privateKeyPem);
    const written = [];
    if (!options.dryRun) {
        for (const file of files) {
            const full = projectPath(cwd, file.path);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, file.contents, "utf8");
            written.push(full);
        }
        await ensureGitignore(cwd);
    }
    return {
        domain,
        did: identity.did.id,
        publicKeyHash: identity.publicKeyHash,
        algorithm,
        dryRun: options.dryRun === true,
        llmsGenerated,
        files,
        written,
    };
}
//# sourceMappingURL=build.js.map