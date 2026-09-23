import { describe, expect, it } from "vitest";
import { registerDomain, TRUSTFLOW_API_BASE } from "../src/api.js";

const live = process.env.TRUSTFLOW_LIVE === "1";

describe.runIf(live)("live Trustflow register", () => {
  it("POST /v1/register returns an SSL challenge", async () => {
    const domain = "agentic-trust-cli.invalid";
    const challenge = await registerDomain(TRUSTFLOW_API_BASE, {
      domain,
      businessName: "Trustflow CLI contract probe",
      verificationType: "SSL_CHALLENGE",
    });
    expect(challenge.domain).toBe(domain);
    expect(challenge.verificationType).toBe("SSL_CHALLENGE");
    expect(challenge.challengeToken.length).toBeGreaterThan(8);
    expect(challenge.challengePath).toBe(
      `https://${domain}/.well-known/agentic-trust-challenge.txt`
    );
    expect(challenge.instructions).toContain("POST /v1/register/confirm");
    expect(challenge.expiresAt).toBeTruthy();
  });
});
