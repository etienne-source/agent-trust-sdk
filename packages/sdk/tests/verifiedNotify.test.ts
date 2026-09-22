import { afterEach, describe, expect, it } from "vitest";
import {
  VERIFIED_NOTIFY_ENV,
  buildVerifiedNotifyPayload,
  isCompleteVerification,
  notifyVerifiedDomain,
} from "../src/verifiedNotify.js";

const ORIGINAL_ENV = process.env[VERIFIED_NOTIFY_ENV];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env[VERIFIED_NOTIFY_ENV];
  else process.env[VERIFIED_NOTIFY_ENV] = ORIGINAL_ENV;
});

function logger() {
  const lines: string[] = [];
  return {
    lines,
    info(message: string) {
      lines.push(message);
    },
    warn(message: string) {
      lines.push(message);
    },
  };
}

describe("notifyVerifiedDomain", () => {
  it("posts only a 100/100 VERIFIED notice", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const log = logger();
    const result = await notifyVerifiedDomain(
      { domain: "HTTPS://Example.COM/path", status: "VERIFIED", score: 100, checkedAt: "2026-09-22T00:00:00.000Z" },
      {
        webhookUrl: "https://hooks.example.com/agentic-trust",
        logger: log,
        fetch: async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} });
          return new Response(null, { status: 204 });
        },
      }
    );

    expect(result).toEqual({ sent: true, reason: "sent", statusCode: 204 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://hooks.example.com/agentic-trust");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.redirect).toBe("error");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      event: "agentic_trust.domain.verified",
      protocol: "AgenticTrust",
      registry: "Trustflow Systems",
      domain: "example.com",
      status: "VERIFIED",
      score: 100,
      maxScore: 100,
      checkedAt: "2026-09-22T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("twitter");
    expect(JSON.stringify(body)).not.toContain("trustflow-sdk");
    expect(log.lines.join("\n")).toContain("hooks.example.com");
    expect(log.lines.join("\n")).not.toContain("hooks.example.com/agentic-trust");
  });

  it("does not call fetch for incomplete scores or a missing webhook", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return new Response("no", { status: 500 });
    };
    const log = logger();

    expect(isCompleteVerification({ domain: "example.com", status: "VERIFIED", score: 99 })).toBe(false);
    expect(isCompleteVerification({ domain: "example.com", status: "UNVERIFIED", score: 100 })).toBe(false);
    expect(isCompleteVerification({ domain: "example.com", status: "VERIFIED", score: 100, maxScore: 90 })).toBe(false);
    expect(isCompleteVerification({ domain: "example.com", status: "verified", score: 100 })).toBe(true);

    const low = await notifyVerifiedDomain(
      { domain: "example.com", status: "VERIFIED", score: 99 },
      { webhookUrl: "https://hooks.example.com/hook", fetch: fetchImpl, logger: log }
    );
    const unverified = await notifyVerifiedDomain(
      { domain: "example.com", status: "RISK", score: 100 },
      { webhookUrl: "https://hooks.example.com/hook", fetch: fetchImpl, logger: log }
    );
    delete process.env[VERIFIED_NOTIFY_ENV];
    const unset = await notifyVerifiedDomain(
      { domain: "example.com", status: "VERIFIED", score: 100 },
      { webhookUrl: "", fetch: fetchImpl, logger: log }
    );

    expect(low.reason).toBe("not_complete");
    expect(unverified.reason).toBe("not_complete");
    expect(unset).toEqual({ sent: false, reason: "webhook_unset" });
    expect(called).toBe(0);
    expect(log.lines.join("\n")).toContain("separate explicit step");
    expect(() => buildVerifiedNotifyPayload({ domain: "example.com", status: "VERIFIED", score: 40 })).toThrow(
      /incomplete/
    );
  });

  it("refuses X, Twitter, and non-HTTPS webhooks before fetch", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return new Response("no", { status: 200 });
    };
    const notice = { domain: "example.com", status: "VERIFIED" as const, score: 100 };
    const hosts = [
      "https://x.com/i/api",
      "https://api.twitter.com/2/tweets",
      "https://mobile.twitter.com/post",
      "http://hooks.example.com/insecure",
      "https://user:secret@hooks.example.com/hook",
    ];
    for (const webhookUrl of hosts) {
      const log = logger();
      const result = await notifyVerifiedDomain(notice, { webhookUrl, fetch: fetchImpl, logger: log });
      expect(result).toEqual({ sent: false, reason: "webhook_rejected" });
      expect(log.lines.join("\n")).toContain("does not post to X");
    }
    expect(called).toBe(0);
  });
});
