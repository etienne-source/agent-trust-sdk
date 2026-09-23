import { confirmRegistration, resolveTrustflowApiBase } from "./api.js";
import { embedBadge, renderBadge } from "./badge.js";
import { readRegistration } from "./project.js";
export async function runConfirm(options) {
    const stored = await readRegistration(options.cwd);
    const domain = options.domain?.trim() || stored?.domain;
    const challengeToken = options.token?.trim() || stored?.challengeToken;
    if (!domain || !challengeToken) {
        throw new Error("domain and challengeToken are required. Run trustflow init first, or pass --domain and --token.");
    }
    const apiBase = resolveTrustflowApiBase(options.apiUrl ?? options.envApiUrl ?? stored?.apiBase);
    options.log(`Trustflow API: POST ${apiBase}/v1/register/confirm`);
    const result = await confirmRegistration(apiBase, {
        domain,
        challengeToken,
        did: stored?.did,
        publicKeyHash: stored?.publicKeyHash,
        services: stored?.services,
        businessName: stored?.businessName,
    }, options.fetch);
    options.log("Registration confirmed.");
    options.log(JSON.stringify(result, null, 2));
    if (options.printBadge !== false) {
        const embedded = await embedBadge(options.cwd, domain);
        if (embedded.status === "written")
            options.log(`Wrote the Trustflow badge into ${embedded.file}`);
        else if (embedded.status === "present")
            options.log("Trustflow badge is already in the page.");
        options.log("");
        options.log("Embeddable badge:");
        options.log(renderBadge(domain));
        options.log("");
    }
    return 0;
}
//# sourceMappingURL=confirm.js.map