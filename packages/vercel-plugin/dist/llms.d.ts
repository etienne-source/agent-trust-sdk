export interface LlmsInput {
    name: string;
    description: string;
    domain: string;
    services: string[];
}
export declare function renderLlms(input: LlmsInput): string;
export declare function alignLlmsTxt(body: string, domain: string): string;
export declare function headingName(text: string): string | undefined;
export declare function findLlmsFile(cwd: string): Promise<string | undefined>;
export declare function parseServiceList(value: string | undefined): string[];
//# sourceMappingURL=llms.d.ts.map