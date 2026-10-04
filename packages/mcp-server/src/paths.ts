import { realpathSync } from "node:fs";
import path from "node:path";

function realpathOfExisting(target: string): string {
  let current = target;
  const rest: string[] = [];
  while (true) {
    try {
      return path.join(realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `target` against `root` and refuse anything outside it, including a symlink
 * inside the root that points out. Tool arguments come from a model, so paths are untrusted.
 */
export function resolveInsideRoot(root: string, target: string, label: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, target);
  const realBase = realpathOfExisting(base);
  const realFull = realpathOfExisting(full);
  const inside = (candidate: string, dir: string) => candidate === dir || candidate.startsWith(dir + path.sep);
  if (!inside(full, base) || !inside(realFull, realBase)) {
    throw new Error(`${label} must be inside ${base}: ${target}`);
  }
  return full;
}
