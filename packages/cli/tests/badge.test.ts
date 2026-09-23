import { describe, expect, it } from "vitest";
import { renderBadge, verifyPageUrl } from "../src/badge.js";

describe("badge", () => {
  it("links to the Trustflow verify page with the required label", () => {
    const html = renderBadge("example.com");
    expect(verifyPageUrl("example.com")).toBe("https://trustflow.systems/verify/example.com");
    expect(html).toContain('href="https://trustflow.systems/verify/example.com"');
    expect(html).toContain("Verified Domain Context | Trustflow");
    expect(html).toContain("<svg");
    expect(html).toContain("</a>");
  });
});
