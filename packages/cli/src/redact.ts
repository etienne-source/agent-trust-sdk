const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

/**
 * Remove private-key material from a log line. Challenge tokens and other
 * tracked secrets are removed by exact match. The function never returns the
 * original secret substrings when they are long enough to be distinctive.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text.replace(PEM_BLOCK, "[redacted-private-key]");
  for (const secret of secrets) {
    if (!secret) continue;
    for (const line of secret.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length < 12) continue;
      if (trimmed.startsWith("-----")) continue;
      out = out.split(trimmed).join("[redacted]");
    }
    if (secret.length >= 12) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

/** Ask GitHub Actions to mask each non-empty line. No-op outside Actions. */
export function maskForGitHubActions(value: string | undefined): void {
  if (!value || !process.env.GITHUB_ACTIONS) return;
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 8 || trimmed.startsWith("-----")) continue;
    process.stdout.write(`::add-mask::${trimmed}\n`);
  }
}
