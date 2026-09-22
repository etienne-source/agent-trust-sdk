import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distCjs = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cjs");
writeFileSync(join(distCjs, "package.json"), "{\"type\":\"commonjs\"}\n");
