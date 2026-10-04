import { confirmRegistration, resolveTrustflowApiBase } from "./api.js";
import { applyBadge, verifyPageUrl } from "./badge.js";
import { readRegistration } from "./project.js";
import { confirmResultVerified } from "./proofs.js";

export interface ConfirmOptions {
  cwd: string;
  domain?: string;
  token?: string;
  apiUrl?: string;
  envApiUrl?: string;
  fetch: typeof fetch;
  log: (line?: string) => void;
  /** When false, do not write the badge even after a verified confirm. */
  writeBadge?: boolean;
}

export async function runConfirm(options: ConfirmOptions): Promise<number> {
  const stored = await readRegistration(options.cwd);
  const domain = options.domain?.trim() || stored?.domain;
  const challengeToken = options.token?.trim() || stored?.challengeToken;
  if (!domain || !challengeToken) {
    throw new Error(
      "domain and challengeToken are required. Run trustflow init first, or pass --domain and --token."
    );
  }
  const apiBase = resolveTrustflowApiBase(options.apiUrl ?? options.envApiUrl ?? stored?.apiBase);
  options.log(`Trustflow API: POST ${apiBase}/v1/register/confirm`);
  const result = await confirmRegistration(
    apiBase,
    {
      domain,
      challengeToken,
      did: stored?.did,
      publicKeyHash: stored?.publicKeyHash,
      services: stored?.services,
      businessName: stored?.businessName,
    },
    options.fetch
  );
  if (!confirmResultVerified(result)) {
    options.log("Confirm returned without a verified status. The badge was not written.");
    options.log(JSON.stringify(result, null, 2));
    return 1;
  }
  options.log("Registration confirmed.");
  options.log(JSON.stringify(result, null, 2));
  options.log(`Verify: ${verifyPageUrl(domain)}`);
  if (options.writeBadge !== false) {
    return applyBadge(options.cwd, domain, options.log);
  }
  return 0;
}
