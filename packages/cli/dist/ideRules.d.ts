/** Project-root files `agentic-trust init` writes for coding agents. */
export declare const CURSORRULES_RELATIVE = ".cursorrules";
export declare const CURSOR_MDC_RELATIVE = ".cursor/rules/agentic-trust.mdc";
export interface IdeRulePaths {
    publicDir: string;
    did: string;
    llms: string;
    llmsWellKnown: string;
}
export declare function ideRulePaths(publicDir: string): IdeRulePaths;
/**
 * Static folder this repo already uses for public files.
 * Prefers `public/`, then `static/`. Otherwise the AgenticTrust default `public`.
 */
export declare function detectPublicDir(cwd: string): Promise<string>;
export declare function renderIdeRuleBody(publicDir: string): string;
export declare function renderCursorRulesFile(publicDir: string): string;
export declare function renderCursorMdc(publicDir: string): string;
export declare function mergeCursorRules(existing: string | undefined, generated: string): string;
export declare function writeIdeRules(cwd: string, publicDir?: string): Promise<{
    cursorrules: string;
    mdc: string;
    publicDir: string;
}>;
//# sourceMappingURL=ideRules.d.ts.map