import { promises as fs } from "node:fs";
import path from "node:path";
import { createSignedDidDocument } from "./identity.js";
import { normalizeDomain, wellKnownLlmsUrl } from "./tls.js";
function envValue(env, name) {
    const value = env[name];
    return value && value.trim() ? value.trim() : undefined;
}
function assertPublic(relative, contents, secret) {
    if ((secret.length > 0 && contents.includes(secret)) ||
        contents.includes("BEGIN PRIVATE KEY") ||
        contents.includes("BEGIN OPENSSH PRIVATE KEY")) {
        throw new Error(`Refusing to publish a private key in ${relative}`);
    }
}
function algorithmFromJws(jws) {
    const part = jws?.split(".")[0];
    if (!part)
        throw new Error("Signed did.json is missing a JWS proof");
    let header;
    try {
        header = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    }
    catch {
        throw new Error("Signed did.json has an unreadable JWS header");
    }
    if (header.alg === "EdDSA" || header.alg === "ES256")
        return header.alg;
    throw new Error("Signed did.json uses an unexpected JWS alg");
}
/**
 * Sign a `did:web` document for a build hook.
 * Uses `createSignedDidDocument` so Vercel, Netlify, and CI share one signer.
 * The private key is not part of the result.
 */
export async function signBuildArtifacts(input) {
    const privateKeyPem = input.privateKeyPem?.trim() ?? "";
    if (!privateKeyPem) {
        throw new Error("AGENTIC_TRUST_PRIVATE_KEY is not set. Add the Ed25519 or P-256 PEM as a build secret. It is not written and it is not printed.");
    }
    const identity = await createSignedDidDocument({
        domain: input.domain,
        privateKeyPem,
        services: input.services,
    });
    const didJson = `${JSON.stringify(identity.did, null, 2)}\n`;
    assertPublic("did.json", didJson, privateKeyPem);
    assertPublic("did.json", didJson, identity.privateKeyPem);
    return {
        domain: identity.domain,
        did: identity.did,
        didJson,
        publicKeyPem: identity.publicKeyPem,
        publicKeyHash: identity.publicKeyHash,
        algorithm: algorithmFromJws(identity.did.proof?.jws),
    };
}
function parseServiceList(value) {
    if (!value)
        return [];
    return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
}
function headingName(text) {
    const match = /^#\s+(.+)$/m.exec(text);
    const name = match?.[1]?.trim();
    return name || undefined;
}
function renderLlms(input) {
    const lines = [`# ${input.name}`, `> ${input.description}`, "", `Domain: ${input.domain}`, ""];
    if (input.services.length > 0) {
        lines.push("## Services", ...input.services.map((service) => `- ${service}`), "");
    }
    lines.push("## Identity", `- DID: did:web:${input.domain}`, `- Manifest: https://${input.domain}/.well-known/did.json`, "", "## Trust", "Verified Domain Context | Trustflow (https://trustflow.systems).", "Agents should call verifyDomain before tool invocation.", "");
    return lines.join("\n");
}
function alignLlmsTxt(body, domain) {
    const did = `did:web:${domain}`;
    const manifest = `https://${domain}/.well-known/did.json`;
    let text = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
    if (/^- DID:\s*.*$/m.test(text))
        text = text.replace(/^- DID:\s*.*$/m, `- DID: ${did}`);
    if (/^- Manifest:\s*.*$/m.test(text))
        text = text.replace(/^- Manifest:\s*.*$/m, `- Manifest: ${manifest}`);
    if (!/^## Identity\s*$/m.test(text)) {
        text += `\n\n## Identity\n- DID: ${did}\n- Manifest: ${manifest}`;
    }
    else {
        if (!text.includes(`- DID: ${did}`))
            text = text.replace(/^## Identity\s*$/m, `## Identity\n- DID: ${did}`);
        if (!text.includes(`- Manifest: ${manifest}`)) {
            text = text.replace(`- DID: ${did}`, `- DID: ${did}\n- Manifest: ${manifest}`);
        }
    }
    if (!/^## Trust\s*$/m.test(text)) {
        text +=
            "\n\n## Trust\nVerified Domain Context | Trustflow (https://trustflow.systems).\nAgents should call verifyDomain before tool invocation.";
    }
    return text.endsWith("\n") ? text : `${text}\n`;
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
function projectPath(cwd, relative) {
    const full = path.resolve(cwd, relative);
    const root = path.resolve(cwd);
    if (full !== root && !full.startsWith(root + path.sep)) {
        throw new Error(`Refusing to write outside the project directory: ${relative}`);
    }
    return full;
}
async function readOptional(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    }
    catch {
        return undefined;
    }
}
function flag(value, fallback) {
    if (value === undefined)
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1")
        return true;
    if (normalized === "false" || normalized === "0")
        return false;
    return fallback;
}
/**
 * Renew public `did.json` and `llms.txt` during a Vercel or Netlify build.
 * Reads `AGENTIC_TRUST_PRIVATE_KEY` and `AGENTIC_TRUST_DOMAIN` when options omit them.
 * The private key is not written, not returned, and not included in error text.
 */
export async function renewBuildSignatures(options = {}) {
    const env = options.env ?? process.env;
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const domainInput = options.domain?.trim() ||
        envValue(env, "AGENTIC_TRUST_DOMAIN") ||
        envValue(env, "VERCEL_PROJECT_PRODUCTION_URL") ||
        envValue(env, "URL") ||
        envValue(env, "VERCEL_URL");
    if (!domainInput) {
        throw new Error("AGENTIC_TRUST_DOMAIN is not set. Set the hostname for the build. This hook does not prompt.");
    }
    const domain = normalizeDomain(domainInput);
    const privateKeyPem = (options.privateKeyPem ?? envValue(env, "AGENTIC_TRUST_PRIVATE_KEY") ?? "").trim();
    const rotate = options.rotate ?? flag(envValue(env, "AGENTIC_TRUST_ROTATE"), true);
    const dryRun = options.dryRun ?? flag(envValue(env, "AGENTIC_TRUST_DRY_RUN"), false);
    const explicitDid = options.didPath?.trim() || envValue(env, "AGENTIC_TRUST_DID_PATH");
    const explicitLlms = options.llmsPath?.trim() || envValue(env, "AGENTIC_TRUST_LLMS_PATH");
    const explicitWellKnown = options.wellKnownLlmsPath === false
        ? false
        : options.wellKnownLlmsPath?.trim() || envValue(env, "AGENTIC_TRUST_WELL_KNOWN_LLMS_PATH");
    let outDir = options.outDir?.trim() || envValue(env, "AGENTIC_TRUST_OUT_DIR");
    if (!outDir && !explicitDid && !explicitLlms) {
        outDir = (await pathExists(path.join(cwd, "public"), "dir")) ? "public" : ".";
    }
    const prefix = !outDir || outDir === "." ? "" : `${outDir.replace(/\\/g, "/").replace(/\/$/, "")}/`;
    const didPath = explicitDid || `${prefix}.well-known/did.json`;
    const llmsPath = explicitLlms || `${prefix}llms.txt`;
    const wellKnownLlmsPath = explicitWellKnown === false ? undefined : explicitWellKnown || (explicitLlms ? undefined : `${prefix}.well-known/llms.txt`);
    const existingDid = await readOptional(projectPath(cwd, didPath));
    const existingLlms = await readOptional(projectPath(cwd, llmsPath));
    const services = parseServiceList(options.services ?? envValue(env, "AGENTIC_TRUST_SERVICES"));
    const businessName = (options.businessName?.trim() ||
        envValue(env, "AGENTIC_TRUST_BUSINESS_NAME") ||
        (existingLlms ? headingName(existingLlms) : undefined) ||
        domain).trim();
    const description = (options.description?.trim() ||
        envValue(env, "AGENTIC_TRUST_DESCRIPTION") ||
        "AI-discoverable business services").trim();
    const llmsGenerated = existingLlms === undefined;
    const llmsTxt = existingLlms
        ? alignLlmsTxt(existingLlms, domain)
        : renderLlms({ name: businessName, description, domain, services });
    const keepDid = rotate === false && existingDid !== undefined;
    let didJson = existingDid;
    let publicKeyHash = "";
    let algorithm = "EdDSA";
    let didId = `did:web:${domain}`;
    if (!keepDid) {
        const signed = await signBuildArtifacts({
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
        didJson = signed.didJson;
        publicKeyHash = signed.publicKeyHash;
        algorithm = signed.algorithm;
        didId = signed.did.id ?? didId;
    }
    else if (didJson) {
        assertPublic(didPath, didJson, privateKeyPem);
        try {
            const parsed = JSON.parse(didJson);
            if (typeof parsed.id === "string")
                didId = parsed.id;
            if (parsed.proof?.jws)
                algorithm = algorithmFromJws(parsed.proof.jws);
        }
        catch {
            // an existing document that is not JSON is still left untouched when rotate is false
        }
    }
    if (!didJson) {
        throw new Error(`Refusing to publish an empty did.json at ${didPath}`);
    }
    const files = [
        { path: llmsPath, contents: llmsTxt.endsWith("\n") ? llmsTxt : `${llmsTxt}\n` },
        { path: didPath, contents: didJson.endsWith("\n") ? didJson : `${didJson}\n` },
    ];
    if (wellKnownLlmsPath) {
        files.splice(1, 0, {
            path: wellKnownLlmsPath,
            contents: llmsTxt.endsWith("\n") ? llmsTxt : `${llmsTxt}\n`,
        });
    }
    for (const file of files)
        assertPublic(file.path, file.contents, privateKeyPem);
    const written = [];
    if (!dryRun) {
        for (const file of files) {
            if (keepDid && file.path === didPath)
                continue;
            const full = projectPath(cwd, file.path);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, file.contents, "utf8");
            written.push(full);
        }
    }
    return {
        domain,
        did: didId,
        publicKeyHash,
        algorithm,
        rotated: !keepDid && existingDid !== undefined,
        dryRun,
        llmsGenerated,
        files,
        written,
    };
}
//# sourceMappingURL=buildSign.js.map