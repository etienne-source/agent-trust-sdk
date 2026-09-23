const { withAgenticTrust } = require("@trustflow/next-plugin");

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 16 runs Turbopack by default and exits if a plugin adds `webpack`
  // without a `turbopack` key. @trustflow/next-plugin attaches that hook for
  // the development identity check; an empty turbopack config keeps `pnpm dev` up.
  turbopack: {},
  agentRules: false,
};

module.exports = withAgenticTrust(nextConfig);
