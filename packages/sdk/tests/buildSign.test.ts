import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSignedDidDocument } from "../src/identity.js";
import { renewBuildSignatures, signBuildArtifacts } from "../src/buildSign.js";

async function privateKey(): Promise<string> {
  const identity = await createSignedDidDocument({ domain: "key.example" });
  return identity.privateKeyPem;
}

describe("signBuildArtifacts", () => {
  it("signs did.json with the SDK signer and does not return the private key", async () => {
    const pem = await privateKey();
    const signed = await signBuildArtifacts({ domain: "https://Shop.Example", privateKeyPem: pem });
    expect(signed.domain).toBe("shop.example");
    expect(signed.did.id).toBe("did:web:shop.example");
    expect(signed.algorithm).toBe("EdDSA");
    expect(signed.publicKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.didJson).toContain("https://shop.example/.well-known/llms.txt");
    expect(signed.did.proof?.jws?.split(".")).toHaveLength(3);
    const dumped = JSON.stringify(signed);
    expect(dumped).not.toContain(pem);
    expect(dumped).not.toContain("BEGIN PRIVATE KEY");
    expect("privateKeyPem" in signed).toBe(false);
  });
});

describe("renewBuildSignatures", () => {
  it("rotates public did.json and llms.txt for a Vercel or Netlify build", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-"));
    const pem = await privateKey();
    const first = await renewBuildSignatures({
      cwd,
      domain: "netlify.example",
      privateKeyPem: pem,
      outDir: "dist",
      businessName: "Netlify Shop",
      services: "Catalog, Docs",
      env: {},
    });
    expect(first.rotated).toBe(false);
    expect(first.llmsGenerated).toBe(true);
    expect(first.written).toHaveLength(3);
    const didPath = path.join(cwd, "dist/.well-known/did.json");
    const before = await readFile(didPath, "utf8");
    expect(before).not.toContain("BEGIN PRIVATE KEY");
    expect(before).not.toContain(pem);

    const second = await renewBuildSignatures({
      cwd,
      domain: "netlify.example",
      privateKeyPem: pem,
      outDir: "dist",
      env: {},
    });
    expect(second.rotated).toBe(true);
    expect(second.llmsGenerated).toBe(false);
    const after = await readFile(didPath, "utf8");
    expect(after).not.toBe(before);
    expect(JSON.parse(after).id).toBe("did:web:netlify.example");
    const llms = await readFile(path.join(cwd, "dist/llms.txt"), "utf8");
    expect(llms).toContain("# Netlify Shop");
    expect(llms).toContain("- Catalog");
    expect(JSON.stringify(second)).not.toContain(pem);
    expect(await readdir(cwd)).toEqual(["dist"]);
  });

  it("leaves an existing did.json in place when rotate is false and does not write on dry run", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-"));
    const pem = await privateKey();
    await renewBuildSignatures({
      cwd,
      domain: "keep.example",
      privateKeyPem: pem,
      didPath: "public/.well-known/did.json",
      llmsPath: "public/llms.txt",
      wellKnownLlmsPath: false,
      env: {},
    });
    const didPath = path.join(cwd, "public/.well-known/did.json");
    const before = await readFile(didPath, "utf8");
    const kept = await renewBuildSignatures({
      cwd,
      domain: "keep.example",
      privateKeyPem: pem,
      didPath: "public/.well-known/did.json",
      llmsPath: "public/llms.txt",
      wellKnownLlmsPath: false,
      rotate: false,
      env: {},
    });
    expect(kept.rotated).toBe(false);
    expect(await readFile(didPath, "utf8")).toBe(before);
    expect(kept.written).toEqual([path.join(cwd, "public/llms.txt")]);

    const dryCwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-dry-"));
    const dry = await renewBuildSignatures({
      cwd: dryCwd,
      domain: "dry.example",
      privateKeyPem: pem,
      dryRun: true,
      env: {},
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.written).toEqual([]);
    expect(dry.files.some((file) => file.contents.includes(pem))).toBe(false);
    expect(await readdir(dryCwd)).toEqual([]);
  });
});
