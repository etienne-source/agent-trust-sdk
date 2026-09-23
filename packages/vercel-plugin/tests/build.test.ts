import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSignedDidDocument } from "@trustflow/sdk";
import { describe, expect, it } from "vitest";
import {
  agenticTrustBuildCommand,
  runAgenticTrustVercelBuild,
  withAgenticTrustVercelConfig,
} from "../src/index.js";

async function privateKey(): Promise<string> {
  const identity = await createSignedDidDocument({ domain: "key.example" });
  return identity.privateKeyPem;
}

async function project(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agentic-trust-vercel-"));
}

describe("runAgenticTrustVercelBuild", () => {
  it("writes public did.json and llms.txt from an env secret and does not write the key", async () => {
    const cwd = await project();
    await writeFile(path.join(cwd, "next.config.ts"), "export default {};\n");
    const pem = await privateKey();
    const result = await runAgenticTrustVercelBuild({
      cwd,
      privateKeyPem: pem,
      domain: "https://shop.example",
      businessName: "Shop",
      description: "Widgets for agents",
      services: "Catalog, Docs",
      env: {},
    });

    expect(result.domain).toBe("shop.example");
    expect(result.did).toBe("did:web:shop.example");
    expect(result.algorithm).toBe("Ed25519");
    expect(result.llmsGenerated).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.publicKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.written).toHaveLength(3);

    const did = JSON.parse(await readFile(path.join(cwd, "public/.well-known/did.json"), "utf8"));
    expect(did.id).toBe("did:web:shop.example");
    expect(did.proof.jws.split(".")).toHaveLength(3);
    expect(did.service[0].serviceEndpoint).toBe("https://shop.example/.well-known/llms.txt");

    const llms = await readFile(path.join(cwd, "public/llms.txt"), "utf8");
    const copy = await readFile(path.join(cwd, "public/.well-known/llms.txt"), "utf8");
    expect(llms).toBe(copy);
    expect(llms).toContain("DID: did:web:shop.example");
    expect(llms).toContain("Verified Domain Context | Trustflow");
    expect(llms).toContain("https://trustflow.systems");
    expect(llms).toContain("- Catalog");

    const tree = JSON.stringify(result) + llms + JSON.stringify(did);
    expect(tree).not.toContain(pem);
    expect(tree).not.toContain("BEGIN PRIVATE KEY");
    await expect(stat(path.join(cwd, ".agentic-trust"))).rejects.toThrow();
    const ignore = await readFile(path.join(cwd, ".gitignore"), "utf8");
    expect(ignore).toContain(".agentic-trust/");
    expect(ignore).toContain("*.pem");
  });

  it("keeps an existing llms.txt body and aligns the DID", async () => {
    const cwd = await project();
    await mkdir(path.join(cwd, "public"), { recursive: true });
    await writeFile(path.join(cwd, "public/llms.txt"), "# Kept\n\n> Already written\n\n## Services\n- Search\n");
    const result = await runAgenticTrustVercelBuild({
      cwd,
      privateKeyPem: await privateKey(),
      env: { AGENTIC_TRUST_DOMAIN: "kept.example" },
    });
    expect(result.llmsGenerated).toBe(false);
    const llms = await readFile(path.join(cwd, "public/llms.txt"), "utf8");
    expect(llms).toContain("# Kept");
    expect(llms).toContain("- Search");
    expect(llms).toContain("DID: did:web:kept.example");
  });

  it("does not write files when the private key is missing or the run is a dry run", async () => {
    const cwd = await project();
    await expect(runAgenticTrustVercelBuild({ cwd, domain: "missing.example", env: {} })).rejects.toThrow(
      /AGENTIC_TRUST_PRIVATE_KEY/
    );
    expect(await readdir(cwd)).toEqual([]);

    const dry = await runAgenticTrustVercelBuild({
      cwd,
      dryRun: true,
      domain: "dry.example",
      privateKeyPem: await privateKey(),
      env: {},
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.written).toEqual([]);
    expect(dry.files.map((file) => file.path)).toEqual([
      "llms.txt",
      ".well-known/llms.txt",
      ".well-known/did.json",
    ]);
    expect(await readdir(cwd)).toEqual([]);
    expect(JSON.stringify(dry)).not.toContain("BEGIN PRIVATE KEY");
  });

  it("builds a vercel.json command without embedding the key", () => {
    expect(agenticTrustBuildCommand()).toBe("agentic-trust-vercel && next build");
    expect(withAgenticTrustVercelConfig({ framework: "nextjs" }).buildCommand).toBe(
      "agentic-trust-vercel && next build"
    );
    expect(withAgenticTrustVercelConfig({ buildCommand: "pnpm build" }).buildCommand).toBe(
      "agentic-trust-vercel && pnpm build"
    );
    expect(
      withAgenticTrustVercelConfig({ buildCommand: "agentic-trust-vercel && pnpm build" }).buildCommand
    ).toBe("agentic-trust-vercel && pnpm build");
    expect(JSON.stringify(withAgenticTrustVercelConfig({}))).not.toContain("PRIVATE KEY");
  });
});
