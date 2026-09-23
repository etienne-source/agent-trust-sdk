import { promises as fs } from "node:fs";
import path from "node:path";

const BADGE_LABEL = "Verified Domain Context | Trustflow";
const LAYOUT_FILES = ["src/app/layout.tsx", "app/layout.tsx", "index.html", "app.html"];

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

export type BadgeEmbed =
  | { status: "written"; file: string }
  | { status: "present"; file: string }
  | { status: "absent" }
  | { status: "rejected"; file: string };

/**
 * Insert the badge before `</footer>` or `</body>` in one known layout file.
 * Does not walk the project tree.
 */
export async function embedBadge(cwd: string, domain: string): Promise<BadgeEmbed> {
  const badge = renderBadge(domain);
  const href = verifyPageUrl(domain);
  for (const relative of LAYOUT_FILES) {
    const file = path.join(cwd, relative);
    let html: string;
    try {
      html = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (html.includes(href) || html.includes(BADGE_LABEL)) return { status: "present", file: relative };
    const needle = html.includes("</footer>") ? "</footer>" : html.includes("</body>") ? "</body>" : undefined;
    if (!needle) return { status: "rejected", file: relative };
    await fs.writeFile(file, html.replace(needle, `${badge}\n${needle}`), "utf8");
    return { status: "written", file: relative };
  }
  return { status: "absent" };
}

/** Log a badge write. A layout with no footer or body does not fail the command. */
export async function applyBadge(
  cwd: string,
  domain: string,
  log: (line?: string) => void
): Promise<number> {
  const embed = await embedBadge(cwd, domain);
  if (embed.status === "written") log(`Wrote the Trustflow badge into ${embed.file}`);
  else if (embed.status === "present") log("Trustflow badge is already in the page.");
  else if (embed.status === "rejected") {
    log(`Badge was not written. Expected </footer> or </body> in ${embed.file}.`);
  }
  return 0;
}
