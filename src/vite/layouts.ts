import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const USE_LAYOUT = /\buseLayout\(\s*(?:(['"`])([^'"`$\n]+)\1|(false))\s*\)/;

/** The literal passed to the first `useLayout('name')` / `useLayout(false)` call in a page, if any */
export function extractLayout(source: string): string | false | undefined {
  const match = USE_LAYOUT.exec(source);
  if (!match) return undefined;
  return match[3] ? false : match[2];
}

/** Build-time value per page, keyed like `import.meta.glob` keys (`/app/pages/about.vue`). `undefined` results are omitted. */
export function scanPages<T>(
  root: string,
  extract: (source: string) => T | undefined,
): Record<string, T> {
  const pagesDir = path.join(root, "app/pages");
  const result: Record<string, T> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".vue")) {
        let value: T | undefined;
        try {
          value = extract(readFileSync(full, "utf-8"));
        } catch (error) {
          throw new Error(
            `[noofpi] ${path.relative(root, full)}: ${(error as Error).message}`,
          );
        }
        if (value !== undefined)
          result["/" + path.relative(root, full).split(path.sep).join("/")] =
            value;
      }
    }
  };
  if (existsSync(pagesDir)) walk(pagesDir);
  return result;
}

/** Layout per page. Pages without `useLayout` are omitted. */
export function scanPageLayouts(root: string): Record<string, string | false> {
  return scanPages(root, extractLayout);
}
