import { describe, expect, it, vi } from "vitest";
import { createSignedDidDocument } from "../src/identity.js";
import { assessDidDocument, fetchDidDocument } from "../src/localDid.js";

describe("assessDidDocument", () => {
  it("verifies a signed document and rejects malformed shapes without throwing", async () => {
    const identity = await createSignedDidDocument({ domain: "ok.example" });
    const verified = await assessDidDocument("ok.example", identity.did);
    expect(verified.outcome).toBe("verified");

    expect((await assessDidDocument("ok.example", null)).outcome).toBe("malformed");
    expect((await assessDidDocument("ok.example", [])).outcome).toBe("malformed");
    expect((await assessDidDocument("ok.example", "nope")).outcome).toBe("malformed");
    expect((await assessDidDocument("ok.example", 1)).outcome).toBe("malformed");

    const foreign = await assessDidDocument("ok.example", { id: "did:key:z6Mk", verificationMethod: [] });
    expect(foreign).toMatchObject({ outcome: "risk", reason: "DID id is not did:web" });

    const numericId = await assessDidDocument("ok.example", { id: 1 });
    expect(numericId.outcome).toBe("risk");

    const noKey = await assessDidDocument("ok.example", { id: "did:web:ok.example" });
    expect(noKey).toMatchObject({ outcome: "incomplete" });
  });
});

describe("fetchDidDocument", () => {
  it("reports HTTP errors, invalid JSON, and network failures", async () => {
    const http = await fetchDidDocument(
      "missing.example",
      vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
    );
    expect(http).toEqual({ kind: "http", status: 404 });

    const invalid = await fetchDidDocument(
      "bad.example",
      vi.fn(async () => new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch
    );
    expect(invalid.kind).toBe("invalid-json");

    const network = await fetchDidDocument(
      "down.example",
      vi.fn(async () => {
        throw new TypeError("network down");
      }) as unknown as typeof fetch
    );
    expect(network).toMatchObject({ kind: "network" });

    const timedOut = await fetchDidDocument(
      "slow.example",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "TimeoutError");
      }) as unknown as typeof fetch
    );
    expect(timedOut.kind).toBe("network");
  });
});
