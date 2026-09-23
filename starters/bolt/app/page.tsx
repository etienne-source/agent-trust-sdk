export default function HomePage() {
  return (
    <main>
      <p>Trustflow · Bolt.new starter</p>
      <h1>Placeholder did:web identity</h1>
      <p>
        This Next.js app is shaped so it can be dropped into a Bolt.new template.{" "}
        <code>next.config.js</code> uses CommonJS <code>withAgenticTrust(...)</code>, which WebContainers can load
        with <code>require</code>.
      </p>
      <p>
        <code>public/llms.txt</code> and <code>public/.well-known/did.json</code> contain <code>REPLACE_ME</code>.
        Run <code>npx @trustflow/cli@latest init</code> before you publish the project as a template.
      </p>
      <p>Protocol: Trustflow. Hosted registry: Trustflow Systems.</p>
    </main>
  );
}
