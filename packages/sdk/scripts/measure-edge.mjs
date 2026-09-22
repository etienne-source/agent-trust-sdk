/**
 * Measure the edge/client bundle for `@agentic-trust/sdk/edge`.
 *
 * Method: esbuild bundles the TypeScript entry as one minified ESM file for
 * the browser, with no external packages. The byte length of that file is the
 * bundle size. Gzip size is reported beside it. The limit is 10KB (10240 bytes)
 * of minified source, not gzip.
 *
 *   pnpm --filter @agentic-trust/sdk bundle:edge
 */
import esbuild from "esbuild";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limitBytes = 10 * 1024;

const builds = [
  {
    name: "@agentic-trust/sdk/edge",
    entryPoints: [path.join(root, "src/edge.ts")],
  },
  {
    name: "edge client import",
    stdin: {
      contents: [
        'import { assertHttpsEndpoint, didWebId, normalizeDomain, wellKnownDidUrl, wellKnownLlmsUrl } from "./edge.ts";',
        "export function ready(host) {",
        "  const domain = normalizeDomain(host);",
        "  return assertHttpsEndpoint(wellKnownDidUrl(domain)) && didWebId(domain).length > 0 && wellKnownLlmsUrl(domain).length > 0;",
        "}",
        "",
      ].join("\n"),
      resolveDir: path.join(root, "src"),
      sourcefile: "client.ts",
      loader: "ts",
    },
  },
];

const results = [];
for (const build of builds) {
  const output = await esbuild.build({
    ...(build.entryPoints ? { entryPoints: build.entryPoints } : { stdin: build.stdin }),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
  });
  const file = output.outputFiles[0];
  if (!file) throw new Error(`esbuild produced no output for ${build.name}`);
  const minifiedBytes = file.contents.byteLength;
  const gzipBytes = gzipSync(file.contents).byteLength;
  results.push({ name: build.name, minifiedBytes, gzipBytes, limitBytes });
  if (minifiedBytes >= limitBytes) {
    process.stderr.write(
      `${build.name} is ${minifiedBytes} bytes, over the ${limitBytes} byte edge limit.\n`
    );
    process.exitCode = 1;
  }
}

process.stdout.write(`${JSON.stringify({ method: "esbuild minify esm browser", results }, null, 2)}\n`);
