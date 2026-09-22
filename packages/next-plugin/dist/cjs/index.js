"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENTIC_TRUST_DEV_WARNING = void 0;
exports.projectIdentityVerified = projectIdentityVerified;
exports.withAgenticTrust = withAgenticTrust;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Printed when a development server loads a project whose AgenticTrust
 * domain identity files are missing or invalid. The Next.js build is not failed.
 */
exports.AGENTIC_TRUST_DEV_WARNING = "[AgenticTrust Warning] Domain identity unverified. Run 'npx agentic-trust init' to generate did:web identity.";
const LLMS_RELATIVE = node_path_1.default.join("public", "llms.txt");
const DID_RELATIVE = node_path_1.default.join("public", ".well-known", "did.json");
function readTextFile(filePath) {
    try {
        const stat = node_fs_1.default.statSync(filePath);
        if (!stat.isFile())
            return undefined;
        return node_fs_1.default.readFileSync(filePath, "utf8");
    }
    catch {
        return undefined;
    }
}
function isValidLlms(text) {
    return typeof text === "string" && text.trim().length > 0;
}
function isValidDid(text) {
    if (!isValidLlms(text))
        return false;
    try {
        JSON.parse(text);
        return true;
    }
    catch {
        return false;
    }
}
/** True when both public identity files exist and are usable. */
function projectIdentityVerified(cwd) {
    const llms = readTextFile(node_path_1.default.join(cwd, LLMS_RELATIVE));
    const did = readTextFile(node_path_1.default.join(cwd, DID_RELATIVE));
    return isValidLlms(llms) && isValidDid(did);
}
function resolveProjectDir(cwd, fallback) {
    const preferred = cwd?.trim() ? cwd : fallback;
    return node_path_1.default.resolve(preferred?.trim() ? preferred : process.cwd());
}
function warnUnverified() {
    try {
        console.warn(exports.AGENTIC_TRUST_DEV_WARNING);
    }
    catch {
        // A broken console must not fail `next dev` or `next build`.
    }
}
function attachDevIdentityCheck(nextConfig, options) {
    const checked = new Set();
    const run = (cwd, fallback) => {
        if (process.env.NODE_ENV !== "development")
            return;
        const projectDir = resolveProjectDir(cwd, fallback ?? options.cwd);
        if (checked.has(projectDir))
            return;
        checked.add(projectDir);
        let verified = false;
        try {
            verified = projectIdentityVerified(projectDir);
        }
        catch {
            verified = false;
        }
        if (!verified)
            warnUnverified();
    };
    run(options.cwd);
    const userWebpack = nextConfig.webpack;
    const webpack = (config, context) => {
        const dir = context && typeof context.dir === "string" ? context.dir : undefined;
        run(dir, options.cwd ?? process.cwd());
        if (typeof userWebpack === "function") {
            return userWebpack(config, context);
        }
        return config;
    };
    return {
        ...nextConfig,
        webpack,
    };
}
function withAgenticTrust(nextConfig, options = {}) {
    if (typeof nextConfig === "function") {
        return (phase, context) => {
            const resolved = nextConfig(phase, context);
            if (resolved instanceof Promise) {
                return resolved.then((config) => attachDevIdentityCheck(config ?? {}, options));
            }
            return attachDevIdentityCheck(resolved ?? {}, options);
        };
    }
    return attachDevIdentityCheck(nextConfig ?? {}, options);
}
//# sourceMappingURL=index.js.map