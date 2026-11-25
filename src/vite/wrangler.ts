import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { WRANGLER_CONFIGS } from "./platform";

/**
 * `compatibility_date` of the generated `wrangler.json` when the project's own wrangler config sets none.
 * Pinned so a build does not pick up the runtime changes of the day it runs on; raise it with a
 * `compatibility_date` in the project's `wrangler.json`.
 */
export const DEFAULT_COMPATIBILITY_DATE = "2026-01-01";

/** Comments and trailing commas of a JSONC document removed (strings are left alone) */
export function stripJsonc(text: string): string {
  let out = "";
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"')
        end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      if (ch === "}" || ch === "]") out = out.replace(/,(\s*)$/, "$1");
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * The project's own `wrangler.json` / `wrangler.jsonc` (bindings, vars, routes...), `undefined` without one.
 * A `wrangler.toml` is not read: the build warns and the generated config goes without it.
 */
export function readUserWranglerConfig(
  root: string,
): Record<string, unknown> | undefined {
  const file = WRANGLER_CONFIGS.map((name) => path.join(root, name)).find(
    existsSync,
  );
  if (!file) return undefined;
  if (file.endsWith(".toml")) {
    console.warn(
      "[noofpi] wrangler.toml is not merged into .output/wrangler.json: use wrangler.json or wrangler.jsonc for bindings and vars",
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(file, "utf-8")));
  } catch (error) {
    throw new Error(
      `[noofpi] Could not parse ${path.basename(file)}: ${(error as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(
      `[noofpi] ${path.basename(file)} must contain a JSON object`,
    );
  return parsed as Record<string, unknown>;
}

/**
 * `.output/wrangler.json` of the `cloudflare-worker` preset: the project's wrangler config on top of the
 * defaults (`name`, `compatibility_date`), with `nodejs_compat` always on and the build's own `main` and
 * `assets.directory`. Fields that refer to the project's layout (`$schema`, `build`, `pages_build_output_dir`)
 * are left out.
 */
export function workerWranglerConfig(
  name: string,
  user: Record<string, unknown> = {},
): Record<string, unknown> {
  const {
    $schema: _schema,
    build: _build,
    pages_build_output_dir: _pages,
    main: _main,
    assets,
    compatibility_flags: flags,
    ...rest
  } = user;
  return {
    name,
    compatibility_date: DEFAULT_COMPATIBILITY_DATE,
    ...rest,
    compatibility_flags: [
      ...new Set(["nodejs_compat", ...(Array.isArray(flags) ? flags : [])]),
    ],
    main: "server/index.mjs",
    assets: {
      ...(assets && typeof assets === "object" ? assets : {}),
      directory: "public",
    },
  };
}
