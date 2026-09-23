const BADGE_LABEL = "Verified Domain Context | Trustflow";

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
