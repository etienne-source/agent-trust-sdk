export default function HomePage() {
  return (
    <main>
      <p>AgenticTrust · Next.js starter</p>
      <h1>Placeholder did:web identity</h1>
      <p>
        This App Router app ships <code>public/llms.txt</code> and <code>public/.well-known/did.json</code>.
        Both files contain <code>REPLACE_ME</code> until you run <code>npx trustflow init</code>.
      </p>
      <p>
        <code>pnpm dev</code> loads <code>withAgenticTrust</code> from <code>next.config.ts</code>. In
        development that check warns when either identity file is missing or the DID document is not JSON.
      </p>
      <p>
        Protocol: AgenticTrust. Hosted registry: Trustflow Systems.
      </p>
    </main>
  );
}
