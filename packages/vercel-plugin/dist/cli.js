#!/usr/bin/env node
import { runAgenticTrustVercelBuild } from "./build.js";
function redact(message, secret) {
    if (!secret)
        return message;
    return message.split(secret).join("[redacted]");
}
const dryRun = process.argv.includes("--dry-run");
const secret = process.env.AGENTIC_TRUST_PRIVATE_KEY;
runAgenticTrustVercelBuild({ dryRun })
    .then((result) => {
    const lines = [
        `Trustflow signed ${result.domain} (${result.algorithm}).`,
        `DID: ${result.did}`,
        `publicKeyHash: ${result.publicKeyHash}`,
        `llms.txt generated: ${result.llmsGenerated ? "yes" : "no"}`,
        result.dryRun
            ? "Dry run. Public files were not written. The private key was not written."
            : `Wrote ${result.written.length} public files. The private key was not written.`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redact(message, secret)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map