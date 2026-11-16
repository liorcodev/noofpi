import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import type { ResolvedNoofpiConfig } from "../config";
import { generateFontCss, type ResolvedFont } from "./css";
import { providers } from "./providers";

export interface FontAssets {
  /** Generated stylesheet with the `@font-face` rules */
  cssFile: string | undefined;
  /** Tailwind `@theme` block, appended to every stylesheet that imports Tailwind */
  theme: string;
}

export const NO_FONTS: FontAssets = { cssFile: undefined, theme: "" };

/** Loads every configured font (downloading Google fonts on first use) and writes `.noofpi/fonts.css` */
export async function resolveFonts(
  root: string,
  config: ResolvedNoofpiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FontAssets> {
  if (config.fonts.length === 0) return NO_FONTS;

  const outDir = path.join(root, ".noofpi");
  const context = {
    root,
    cacheDir: path.join(outDir, "fonts"),
    fetch: fetchImpl,
  };
  const fonts: ResolvedFont[] = await Promise.all(
    config.fonts.map(async (family) => ({
      family,
      faces: await providers[family.provider].resolve(family, context),
    })),
  );

  const { css, theme } = generateFontCss(fonts, outDir, config.tailwind);
  const cssFile = path.join(outDir, "fonts.css");
  await mkdir(outDir, { recursive: true });
  await writeFile(cssFile, css);
  return { cssFile, theme };
}

const TAILWIND_IMPORT = /@import\s+(["'])tailwindcss(?:\/[^"']*)?\1/;

/**
 * Tailwind reads `@theme` only from the stylesheet it is imported into, so a separate generated file can not
 * register `font-<alias>` utilities. This adds the block to each Tailwind entry stylesheet instead.
 * It has to run before the Tailwind plugin.
 */
export function fontThemePlugin(theme: string): Plugin {
  return {
    name: "noofpi:fonts-theme",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?")[0]!.endsWith(".css") || !TAILWIND_IMPORT.test(code))
        return;
      return { code: `${code}\n${theme}`, map: null };
    },
  };
}
