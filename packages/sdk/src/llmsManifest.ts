export interface LlmsManifestInput {
  name: string;
  description: string;
  domain: string;
  services: string[];
}

/** The one llms.txt template used by the CLI, the Vercel build, and the GitHub Action. */
export function renderLlmsManifest(input: LlmsManifestInput): string {
  const lines = [`# ${input.name}`, `> ${input.description}`, "", `Domain: ${input.domain}`, ""];
  if (input.services.length > 0) {
    lines.push("## Services", ...input.services.map((service) => `- ${service}`), "");
  }
  lines.push(
    "## Identity",
    `- DID: did:web:${input.domain}`,
    `- Manifest: https://${input.domain}/.well-known/did.json`,
    "",
    "## Trust",
    "Verified Domain Context | Trustflow (https://trustflow.systems).",
    "Agents should call verifyDomain before tool invocation.",
    ""
  );
  return lines.join("\n");
}

/** Rewrite identity lines so an existing llms.txt names this domain. */
export function alignLlmsTxt(body: string, domain: string): string {
  const did = `did:web:${domain}`;
  const manifest = `https://${domain}/.well-known/did.json`;
  let text = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");

  if (/^- DID:\s*.*$/m.test(text)) {
    text = text.replace(/^- DID:\s*.*$/m, `- DID: ${did}`);
  }
  if (/^- Manifest:\s*.*$/m.test(text)) {
    text = text.replace(/^- Manifest:\s*.*$/m, `- Manifest: ${manifest}`);
  }

  if (!/^## Identity\s*$/m.test(text)) {
    text += `\n\n## Identity\n- DID: ${did}\n- Manifest: ${manifest}`;
  } else {
    if (!text.includes(`- DID: ${did}`)) {
      text = text.replace(/^## Identity\s*$/m, `## Identity\n- DID: ${did}`);
    }
    if (!text.includes(`- Manifest: ${manifest}`)) {
      text = text.replace(new RegExp(`- DID: ${escapeRegExp(did)}`), `- DID: ${did}\n- Manifest: ${manifest}`);
    }
  }

  if (!/^## Trust\s*$/m.test(text)) {
    text += [
      "",
      "",
      "## Trust",
      "Verified Domain Context | Trustflow (https://trustflow.systems).",
      "Agents should call verifyDomain before tool invocation.",
    ].join("\n");
  }

  return `${text}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
