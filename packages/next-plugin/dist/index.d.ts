/**
 * Printed when a development server loads a project whose AgenticTrust
 * domain identity files are missing or invalid. The Next.js build is not failed.
 */
export declare const AGENTIC_TRUST_DEV_WARNING = "[AgenticTrust Warning] Domain identity unverified. Run 'npx agentic-trust init' to generate did:web identity.";
export interface WithAgenticTrustOptions {
    /**
     * Project root that contains `public/`.
     * Defaults to the directory Next.js passes into `webpack`, then `process.cwd()`.
     */
    cwd?: string;
}
export type AgenticTrustWebpackConfig = Record<string, unknown>;
export interface AgenticTrustWebpackContext {
    dir?: string;
    dev?: boolean;
    isServer?: boolean;
    [key: string]: unknown;
}
export type AgenticTrustWebpackFn = (config: AgenticTrustWebpackConfig, context: AgenticTrustWebpackContext) => AgenticTrustWebpackConfig | void;
export interface AgenticTrustNextConfig {
    webpack?: AgenticTrustWebpackFn;
    [key: string]: unknown;
}
export type AgenticTrustWrappedConfig<T extends AgenticTrustNextConfig> = Omit<T, "webpack"> & {
    webpack: AgenticTrustWebpackFn;
};
type NextConfigFunction<T extends AgenticTrustNextConfig> = (phase: string, context: {
    defaultConfig: AgenticTrustNextConfig;
}) => T | Promise<T>;
/** True when both public identity files exist and are usable. */
export declare function projectIdentityVerified(cwd: string): boolean;
/**
 * Wrap a Next.js config and attach a development-time AgenticTrust identity check.
 *
 * When `NODE_ENV` is `development`, the wrapper checks `public/llms.txt` and
 * `public/.well-known/did.json`. Missing, empty, unreadable, or non-JSON
 * identity files print a terminal warning. The returned config is the input
 * spread through, with `webpack` composed so Next.js runs the same check.
 * Production builds stay quiet and are never failed by this plugin.
 */
export declare function withAgenticTrust<T extends AgenticTrustNextConfig>(nextConfig: NextConfigFunction<T>, options?: WithAgenticTrustOptions): (phase: string, context: {
    defaultConfig: AgenticTrustNextConfig;
}) => AgenticTrustWrappedConfig<T> | Promise<AgenticTrustWrappedConfig<T>>;
export declare function withAgenticTrust<T extends AgenticTrustNextConfig>(nextConfig?: T, options?: WithAgenticTrustOptions): AgenticTrustWrappedConfig<T>;
export {};
//# sourceMappingURL=index.d.ts.map