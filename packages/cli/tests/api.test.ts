import { describe, expect, it } from "vitest";
import { resolveTrustflowApiBase, TRUSTFLOW_API_BASE } from "../src/api.js";

describe("resolveTrustflowApiBase", () => {
  it("defaults to the live Trustflow API", () => {
    expect(resolveTrustflowApiBase()).toBe(TRUSTFLOW_API_BASE);
    expect(resolveTrustflowApiBase("")).toBe(TRUSTFLOW_API_BASE);
    expect(TRUSTFLOW_API_BASE).toBe("https://api.trustflow.systems");
  });

  it("maps the site /api/register alias onto the live API", () => {
    expect(resolveTrustflowApiBase("https://trustflow.systems/api/register")).toBe(TRUSTFLOW_API_BASE);
    expect(resolveTrustflowApiBase("https://www.trustflow.systems/api/register")).toBe(TRUSTFLOW_API_BASE);
    expect(resolveTrustflowApiBase("https://trustflow.systems/api")).toBe(TRUSTFLOW_API_BASE);
    expect(resolveTrustflowApiBase("https://www.trustflow.systems/api/")).toBe(TRUSTFLOW_API_BASE);
  });

  it("strips a full /v1/register URL down to the API origin", () => {
    expect(resolveTrustflowApiBase("https://api.trustflow.systems/v1/register")).toBe(TRUSTFLOW_API_BASE);
    expect(resolveTrustflowApiBase("https://api.trustflow.systems/v1/register/confirm")).toBe(
      TRUSTFLOW_API_BASE
    );
  });

  it("keeps a custom base", () => {
    expect(resolveTrustflowApiBase("https://api.example.test/prefix")).toBe("https://api.example.test/prefix");
  });
});
