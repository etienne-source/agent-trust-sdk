import type { AgenticTrustMetadata } from "./agenticTrustMiddleware.js";
export interface ParsedLlmsSection {
    heading: string;
    links: Array<{
        title: string;
        url: string;
        description?: string;
    }>;
}
export interface ParsedLlmsTxt {
    title?: string;
    summary?: string;
    /** Prose between the summary and the first `##` section. */
    details?: string;
    sections: ParsedLlmsSection[];
}
export interface LlmsPayloadSite {
    target: string;
    readContent: () => string;
    path: Array<string | number>;
}
export declare function isLlmsTxtUrl(value: string): boolean;
export declare function isContextTarget(value: string): boolean;
/** Interpret llms.txt markdown. Call only after the domain verifies. */
export declare function parseLlmsTxt(raw: string): ParsedLlmsTxt;
export declare function formatVerifiedLlms(parsed: ParsedLlmsTxt, meta: AgenticTrustMetadata): string;
export declare function readBody(raw: unknown): string;
/**
 * Find llms.txt payloads without reading their bodies.
 * `readContent` is the only path that touches the body.
 */
export declare function collectLlmsPayloads(value: unknown, path?: Array<string | number>, out?: LlmsPayloadSite[], depth?: number): LlmsPayloadSite[];
/** URLs and did:web ids that name domain context, including payloads with no body yet. */
export declare function collectContextTargets(value: unknown, out?: string[], depth?: number): string[];
export declare function cloneValue<T>(value: T): T;
export declare function writeVerifiedText(root: unknown, path: Array<string | number>, formatted: string): void;
//# sourceMappingURL=llmsContext.d.ts.map