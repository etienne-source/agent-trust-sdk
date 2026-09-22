import type { NextConfig } from "next";
import { withAgenticTrust } from "@agentic-trust/next-plugin";

const nextConfig = {
  reactStrictMode: true,
  // Next.js 16 runs Turbopack by default and exits if a plugin adds `webpack`
  // without a `turbopack` key. @agentic-trust/next-plugin attaches that hook for
  // the development identity check; an empty turbopack config keeps `pnpm dev` up.
  turbopack: {},
  agentRules: false,
} satisfies NextConfig;

export default withAgenticTrust(nextConfig);
