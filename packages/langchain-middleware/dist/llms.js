const TARGET_KEYS = ["target", "url", "domain", "source", "href", "pageUrl"];
const BODY_KEYS = ["llmsTxt", "llms_txt", "llms"];
const WALK_KEYS = [
    "content",
    "kwargs",
    "messages",
    "prompt",
    "pageContent",
    "args",
    "arguments",
    "input",
    "toolCall",
    "metadata",
];
export function isLlmsTxtUrl(value) {
    if (!/^https?:\/\//i.test(value))
        return false;
    try {
        const path = new URL(value).pathname.replace(/\/+$/, "");
        return path === "/llms.txt" || path.endsWith("/llms.txt");
    }
    catch {
        return false;
    }
}
export function isContextTarget(value) {
    const trimmed = value.trim();
    return /^did:web:/i.test(trimmed) || isLlmsTxtUrl(trimmed);
}
/** Interpret llms.txt markdown. Call only after the domain verifies. */
export function parseLlmsTxt(raw) {
    const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
    let title;
    const summaryLines = [];
    let inSummary = false;
    const detailLines = [];
    const sections = [];
    let current;
    for (const line of lines) {
        if (!title && line.startsWith("# ")) {
            title = line.slice(2).trim();
            inSummary = false;
            continue;
        }
        if (line.startsWith(">")) {
            inSummary = true;
            summaryLines.push(line.replace(/^>\s?/, "").trim());
            continue;
        }
        if (inSummary && line.trim() === "") {
            inSummary = false;
            continue;
        }
        inSummary = false;
        if (line.startsWith("## ")) {
            current = { heading: line.slice(3).trim(), links: [] };
            sections.push(current);
            continue;
        }
        const link = /^- \[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/.exec(line.trim());
        if (link && current) {
            const description = link[3]?.trim();
            current.links.push({
                title: link[1] ?? "",
                url: link[2] ?? "",
                ...(description ? { description } : {}),
            });
            continue;
        }
        if (!current && line.trim())
            detailLines.push(line.trim());
    }
    const summary = summaryLines.filter(Boolean).join(" ");
    const details = detailLines.join("\n");
    return {
        ...(title ? { title } : {}),
        ...(summary ? { summary } : {}),
        ...(details ? { details } : {}),
        sections,
    };
}
export function formatVerifiedLlms(parsed, meta) {
    const lines = ["Verified Domain Context | Trustflow", `domain: ${meta.domain}`];
    if (meta.did)
        lines.push(`did: ${meta.did}`);
    if (meta.trustScore !== undefined)
        lines.push(`trustScore: ${meta.trustScore}`);
    if (parsed.title)
        lines.push(`# ${parsed.title}`);
    if (parsed.summary)
        lines.push(`> ${parsed.summary}`);
    if (parsed.details)
        lines.push(parsed.details);
    for (const section of parsed.sections) {
        lines.push(`## ${section.heading}`);
        for (const link of section.links) {
            lines.push(link.description
                ? `- ${link.title}: ${link.description} (${link.url})`
                : `- ${link.title} (${link.url})`);
        }
    }
    return lines.join("\n");
}
export function readBody(raw) {
    if (typeof raw === "function") {
        const value = raw();
        if (typeof value !== "string") {
            throw new Error("llms.txt content function must return a string");
        }
        return value;
    }
    if (typeof raw === "string")
        return raw;
    throw new Error("llms.txt content must be a string or a function that returns a string");
}
function readTarget(record) {
    for (const key of TARGET_KEYS) {
        const value = record[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
function bodyKey(record) {
    for (const key of BODY_KEYS) {
        if (key in record)
            return key;
    }
    return undefined;
}
function peekLlmsEnvelope(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    if (record.metadata && typeof record.metadata === "object") {
        const meta = record.metadata;
        const target = readTarget(meta);
        const marked = meta.type === "llms.txt" ||
            meta.kind === "llms.txt" ||
            (typeof target === "string" && isLlmsTxtUrl(target));
        if (target && marked && ("pageContent" in record || "content" in record)) {
            const contentKey = "pageContent" in record ? "pageContent" : "content";
            return { target, contentKey, readContent: () => readBody(record[contentKey]) };
        }
    }
    const target = readTarget(record);
    if (!target)
        return null;
    const keyed = bodyKey(record);
    if (keyed) {
        return { target, contentKey: keyed, readContent: () => readBody(record[keyed]) };
    }
    if (isLlmsTxtUrl(target) && ("content" in record || "pageContent" in record)) {
        const contentKey = "content" in record ? "content" : "pageContent";
        return { target, contentKey, readContent: () => readBody(record[contentKey]) };
    }
    if ((record.type === "llms.txt" || record.kind === "llms.txt" || record.context === "llms.txt") &&
        ("content" in record || "pageContent" in record)) {
        const contentKey = "content" in record ? "content" : "pageContent";
        return { target, contentKey, readContent: () => readBody(record[contentKey]) };
    }
    return null;
}
function targetFromJsonText(text) {
    const match = /"(?:target|url|domain|source|href|pageUrl)"\s*:\s*"([^"\\]*)"/.exec(text);
    const target = match?.[1]?.trim();
    if (!target)
        return undefined;
    const hasBody = /"(?:llmsTxt|llms_txt|llms|content|pageContent)"\s*:/.test(text);
    if (!hasBody && !isContextTarget(target))
        return undefined;
    return target;
}
function peekLlmsText(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}"))
        return null;
    const target = targetFromJsonText(trimmed);
    if (!target)
        return null;
    return {
        target,
        readContent: () => {
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch {
                throw new Error("llms.txt context envelope is not valid JSON");
            }
            const envelope = peekLlmsEnvelope(parsed);
            if (!envelope)
                throw new Error("llms.txt context envelope has no body");
            return envelope.readContent();
        },
    };
}
/**
 * Find llms.txt payloads without reading their bodies.
 * `readContent` is the only path that touches the body.
 */
export function collectLlmsPayloads(value, path = [], out = [], depth = 0) {
    if (depth > 8 || value == null || typeof value === "function")
        return out;
    const envelope = peekLlmsEnvelope(value);
    if (envelope) {
        out.push({
            target: envelope.target,
            readContent: envelope.readContent,
            path: path.concat(envelope.contentKey),
        });
        return out;
    }
    if (typeof value === "string") {
        const textEnv = peekLlmsText(value);
        if (textEnv)
            out.push({ target: textEnv.target, readContent: textEnv.readContent, path });
        return out;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectLlmsPayloads(item, path.concat(index), out, depth + 1));
        return out;
    }
    if (typeof value === "object") {
        const record = value;
        if (typeof record.text === "string") {
            const textEnv = peekLlmsText(record.text);
            if (textEnv) {
                out.push({
                    target: textEnv.target,
                    readContent: textEnv.readContent,
                    path: path.concat("text"),
                });
            }
        }
        for (const key of WALK_KEYS) {
            if (key in record)
                collectLlmsPayloads(record[key], path.concat(key), out, depth + 1);
        }
    }
    return out;
}
/** URLs and did:web ids that name domain context, including payloads with no body yet. */
export function collectContextTargets(value, out = [], depth = 0) {
    if (depth > 8 || value == null || typeof value === "function")
        return out;
    if (typeof value === "string") {
        if (isContextTarget(value))
            out.push(value.trim());
        return out;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectContextTargets(item, out, depth + 1);
        return out;
    }
    if (typeof value === "object") {
        const record = value;
        const marked = record.type === "llms.txt" || record.kind === "llms.txt" || record.context === "llms.txt";
        for (const key of TARGET_KEYS) {
            const candidate = record[key];
            if (typeof candidate !== "string" || !candidate.trim())
                continue;
            if (marked || isContextTarget(candidate))
                out.push(candidate.trim());
        }
        for (const key of WALK_KEYS) {
            if (key in record)
                collectContextTargets(record[key], out, depth + 1);
        }
    }
    return out;
}
export function cloneValue(value) {
    return cloneNested(value);
}
function cloneNested(value) {
    if (Array.isArray(value))
        return value.map((item) => cloneNested(item));
    if (!value || typeof value !== "object")
        return value;
    const proto = Object.getPrototypeOf(value);
    const draft = proto === Object.prototype || proto === null
        ? {}
        : Object.create(proto);
    for (const key of Object.keys(value)) {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (!desc)
            continue;
        if (desc.get || desc.set) {
            Object.defineProperty(draft, key, desc);
            continue;
        }
        draft[key] = cloneNested(desc.value);
    }
    return draft;
}
export function writeVerifiedText(root, path, formatted) {
    if (path.length === 0)
        return;
    let parent = root;
    for (let i = 0; i < path.length - 1; i++) {
        parent = parent[path[i]];
    }
    Object.defineProperty(parent, path[path.length - 1], {
        value: formatted,
        writable: true,
        configurable: true,
        enumerable: true,
    });
}
//# sourceMappingURL=llms.js.map