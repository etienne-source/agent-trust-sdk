/** Checked in order when no framework config names a directory. `public` wins when both exist. */
export declare const PUBLIC_DIR_CANDIDATES: readonly ["public", "static"];
export type ProjectFramework = "next" | "vite" | "nuxt" | "unknown";
export interface ProjectLayout {
    framework: ProjectFramework;
    /** Site-root static directory, relative to the project, with no leading slash. */
    publicDir: string;
    reason: string;
}
/**
 * Static folder this repo already uses for public files.
 * Prefers `public/`, then `static/`. Otherwise the AgenticTrust default `public`.
 */
export declare function detectPublicDir(cwd: string): Promise<string>;
/**
 * Detect Next.js, Vite, or Nuxt and the directory that is served at the site origin.
 * An explicit framework `publicDir` / `dir.public` wins. Otherwise Next.js and Vite
 * use `public/`, Nuxt 2 uses `static/`, and Nuxt 3 uses `public/`. Unknown projects
 * reuse {@link detectPublicDir}.
 */
export declare function detectProjectLayout(cwd: string): Promise<ProjectLayout>;
/** Major version from a package.json range, when one is present. */
export declare function nuxtMajor(version: string | undefined): number | undefined;
/**
 * Vite `publicDir`. A string is the relative directory, `false` disables the
 * public folder, and `undefined` means the config does not set it.
 */
export declare function parseVitePublicDir(source: string): string | false | undefined;
/** Nuxt `dir.public` or legacy `dir.static`, when the config sets one. */
export declare function parseNuxtPublicDir(source: string): string | undefined;
export declare function assertPublicDir(publicDir: string): string;
//# sourceMappingURL=framework.d.ts.map