import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16">
        <p className="text-neutral-600">
          Edit <code className="rounded bg-neutral-100 px-1.5 py-0.5">app/page.tsx</code> to start a v0-style
          page. Identity files live in <code className="rounded bg-neutral-100 px-1.5 py-0.5">public/</code>.
        </p>
        <p className="text-neutral-600">
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">public/llms.txt</code> and{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">public/.well-known/did.json</code> are
          placeholders marked <code className="rounded bg-neutral-100 px-1.5 py-0.5">REPLACE_ME</code>. Replace
          them with <code className="rounded bg-neutral-100 px-1.5 py-0.5">npx agentic-trust init</code>.
        </p>
        <p className="text-sm text-neutral-500">
          Protocol: AgenticTrust. Hosted registry: Trustflow Systems.{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">next.config.mjs</code> calls{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">withAgenticTrust</code>.
        </p>
      </main>
    </div>
  );
}
