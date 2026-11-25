import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** `node_modules/vue-tsc/bin/vue-tsc.js` of the project, or of a parent directory (monorepos hoist it) */
export function findVueTsc(root: string): string | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js");
    if (existsSync(bin)) return bin;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Runs `vue-tsc --noEmit` in the project and resolves with its exit code */
export function runTypecheck(root: string, args: string[]): Promise<number> {
  const bin = findVueTsc(root);
  if (!bin)
    throw new Error(
      "[noofpi] `noofpi typecheck` needs vue-tsc: install it with `bun add -d vue-tsc typescript`",
    );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "--noEmit", ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
