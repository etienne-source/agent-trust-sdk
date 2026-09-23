import { promises as fs } from "node:fs";
import path from "node:path";

const BADGE_LABEL = "Verified Domain Context | Trustflow";
const LAYOUT_SKIP = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".agentic-trust"]);

/** Public verify page for a normalized domain. */
export function verifyPageUrl(domain: string): string {
  return `https://trustflow.systems/verify/${encodeURIComponent(domain)}`;
}

/**
 * Embeddable HTML badge. The visible label is
 * "Verified Domain Context | Trustflow" and the link target is
 * `https://trustflow.systems/verify/[domain]`.
 */
export function renderBadge(domain: string): string {
  const href = verifyPageUrl(domain);
  return [
    `<a href="${href}" target="_blank" rel="noopener noreferrer">`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="36" viewBox="0 0 320 36" role="img" aria-label="${BADGE_LABEL}">`,
    `  <title>${BADGE_LABEL}</title>`,
    `  <rect width="320" height="36" rx="6" fill="#0f172a"/>`,
    `  <text x="16" y="23" fill="#ffffff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13">${BADGE_LABEL}</text>`,
    `</svg>`,
    `</a>`,
  ].join("\n");
}

export type BadgeEmbed = { status: "written"; file: string } | { status: "present" } | { status: "skipped" };

/**
 * Insert the badge before `</footer>` or `</body>` in the nearest layout.
 * Leaves the file alone when that verify link is already there.
 */
export async function embedBadge(cwd: string, domain: string): Promise<BadgeEmbed> {
  const badge = renderBadge(domain);
  const href = verifyPageUrl(domain);
  const files = await findLayoutFiles(cwd);
  const ranked: Array<{ file: string; html: string; slot: "footer" | "body" }> = [];
  for (const file of files) {
    let html: string;
    try {
      html = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (html.includes(href) || html.includes(BADGE_LABEL)) return { status: "present" };
    if (html.includes("</footer>")) ranked.push({ file, html, slot: "footer" });
    else if (html.includes("</body>")) ranked.push({ file, html, slot: "body" });
  }
  ranked.sort((left, right) => {
    if (left.slot !== right.slot) return left.slot === "footer" ? -1 : 1;
    return left.file.length - right.file.length;
  });
  const target = ranked[0];
  if (!target) return { status: "skipped" };
  const needle = target.slot === "footer" ? "</footer>" : "</body>";
  await fs.writeFile(target.file, target.html.replace(needle, `${badge}\n${needle}`), "utf8");
  return { status: "written", file: path.relative(cwd, target.file).split(path.sep).join("/") };
}

async function findLayoutFiles(cwd: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || found.length > 40) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (LAYOUT_SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (/^layout\.(tsx|jsx)$/.test(entry.name) || entry.name === "index.html" || entry.name === "app.html") {
        found.push(full);
      }
    }
  }
  await walk(cwd, 0);
  return found;
}
