export interface SignLlmsOptions {
    cwd: string;
    log: (line?: string) => void;
}
/**
 * Re-sign an existing llms.txt by rewriting `proof` on the existing did.json.
 * Does not call `/v1/register`, does not write a challenge, and does not rotate keys.
 */
export declare function runSignLlms(options: SignLlmsOptions): Promise<number>;
//# sourceMappingURL=signLlms.d.ts.map