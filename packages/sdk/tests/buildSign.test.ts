import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSignedDidDocument, hashLlmsTxt } from "../src/identity.js";
import { importPublicKey, verifyDidJws } from "../src/jws.js";
import { renewBuildSignatures, signBuildArtifacts } from "../src/buildSign.js";

async function privateKey(): Promise<string> {
  const identity = await createSignedDidDocument({ domain: "key.example" });
  return identity.privateKeyPem;
}

describe("signBuildArtifacts", () => {
  it("signs did.json with the SDK signer and does not return the private key", async () => {
    const pem = await privateKey();
    const signed = await signBuildArtifacts({
      domain: "https://Shop.Example",
      privateKeyPem: pem,
      llmsTxtSha256: hashLlmsTxt("# Shop\n"),
    });
    expect(signed.did.llmsTxtSha256).toBe(hashLlmsTxt("# Shop\n"));
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

  it("refuses to sign without an llms.txt hash", async () => {
    const pem = await privateKey();
    await expect(
      signBuildArtifacts({ domain: "shop.example", privateKeyPem: pem } as unknown as Parameters<typeof signBuildArtifacts>[0])
    ).rejects.toThrow(/llmsTxtSha256 is required/);
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

  it("signs the hash of the llms.txt it publishes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-hash-"));
    const pem = await privateKey();
    await renewBuildSignatures({ cwd, domain: "hash.example", privateKeyPem: pem, outDir: "dist", env: {} });
    const did = JSON.parse(await readFile(path.join(cwd, "dist/.well-known/did.json"), "utf8"));
    const llms = await readFile(path.join(cwd, "dist/llms.txt"), "utf8");
    const wellKnown = await readFile(path.join(cwd, "dist/.well-known/llms.txt"), "utf8");
    expect(wellKnown).toBe(llms);
    expect(did.llmsTxtSha256).toBe(hashLlmsTxt(llms));
    const key = await importPublicKey(did);
    expect(await verifyDidJws(did, key!)).toMatchObject({ ok: true, llmsTxtSha256: hashLlmsTxt(llms) });
  });

  it("signs the user's .well-known/llms.txt instead of the generic template", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-own-"));
    const pem = await privateKey();
    const own = "# Own Shop\n> Hand-written manifest\n\nDomain: own.example\n";
    await mkdir(path.join(cwd, "public/.well-known"), { recursive: true });
    await writeFile(path.join(cwd, "public/.well-known/llms.txt"), own);
    const result = await renewBuildSignatures({ cwd, domain: "own.example", privateKeyPem: pem, env: {} });
    expect(result.llmsGenerated).toBe(false);
    const llms = await readFile(path.join(cwd, "public/llms.txt"), "utf8");
    expect(llms).toContain("> Hand-written manifest");
    expect(llms).not.toContain("AI-discoverable business services");
  });

  it("refuses published llms.txt copies that differ", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-diff-"));
    const pem = await privateKey();
    await mkdir(path.join(cwd, "public/.well-known"), { recursive: true });
    await writeFile(path.join(cwd, "public/llms.txt"), "# A\n");
    await writeFile(path.join(cwd, "public/.well-known/llms.txt"), "# B\n");
    await expect(
      renewBuildSignatures({ cwd, domain: "diff.example", privateKeyPem: pem, env: {} })
    ).rejects.toThrow(/differ/);
  });

  it("refuses an llms.txt that names another domain", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-foreign-"));
    const pem = await privateKey();
    await mkdir(path.join(cwd, "public"), { recursive: true });
    await writeFile(path.join(cwd, "public/llms.txt"), "# Other\nDomain: other.example\n");
    await expect(
      renewBuildSignatures({ cwd, domain: "mine.example", privateKeyPem: pem, wellKnownLlmsPath: false, env: {} })
    ).rejects.toThrow(/names other\.example, not mine\.example/);
  });

  it("refuses to keep a did.json that does not sign the current llms.txt", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-stale-"));
    const pem = await privateKey();
    const options = {
      cwd,
      domain: "stale.example",
      privateKeyPem: pem,
      didPath: "public/.well-known/did.json",
      llmsPath: "public/llms.txt",
      wellKnownLlmsPath: false as const,
      env: {},
    };
    await renewBuildSignatures(options);
    await writeFile(path.join(cwd, "public/llms.txt"), "# Edited\n> New content\n");
    await expect(renewBuildSignatures({ ...options, rotate: false })).rejects.toThrow(/does not sign this llms\.txt/);
  });

  it("does not sign for a Vercel preview hostname", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentic-trust-renew-preview-"));
    const pem = await privateKey();
    await expect(
      renewBuildSignatures({ cwd, privateKeyPem: pem, env: { VERCEL_URL: "app-git-branch.vercel.app" } })
    ).rejects.toThrow(/AGENTIC_TRUST_DOMAIN is not set/);
  });
});
