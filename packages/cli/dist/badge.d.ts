/** Public verify page for a normalized domain. */
export declare function verifyPageUrl(domain: string): string;
/**
 * Embeddable HTML badge. The visible label is
 * "Verified Domain Context | Trustflow" and the link target is
 * `https://trustflow.systems/verify/[domain]`.
 */
export declare function renderBadge(domain: string): string;
export type BadgeEmbed = {
    status: "written";
    file: string;
} | {
    status: "present";
} | {
    status: "skipped";
};
/**
 * Insert the badge before `</footer>` or `</body>` in the nearest layout.
 * Leaves the file alone when that verify link is already there.
 */
export declare function embedBadge(cwd: string, domain: string): Promise<BadgeEmbed>;
//# sourceMappingURL=badge.d.ts.map