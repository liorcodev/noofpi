import path from "node:path";
import { normalizePath } from "vite";
import type { FontFaceDescriptor, ResolvedFontFamily } from "./types";

export interface ResolvedFont {
  family: ResolvedFontFamily;
  faces: FontFaceDescriptor[];
}

const quote = (value: string) => JSON.stringify(value);

/** `"Inter", ui-sans-serif, sans-serif` */
export function fontStack(family: ResolvedFontFamily): string {
  return [quote(family.name), ...family.fallback].join(", ");
}

/**
 * `css` holds the `@font-face` rules (urls relative to `cssDir`, so vite bundles and hashes the files).
 * Without Tailwind the stacks are exposed as `:root` variables; with Tailwind they go in `theme`, an `@theme`
 * block that has to live in the stylesheet that imports Tailwind (see `fontThemePlugin`).
 */
export function generateFontCss(
  fonts: ResolvedFont[],
  cssDir: string,
  tailwind: boolean,
): { css: string; theme: string } {
  const rules: string[] = [];
  for (const { family, faces } of fonts) {
    for (const face of faces) {
      const src = face.sources
        .map(({ file, format }) => {
          const relative = normalizePath(path.relative(cssDir, file));
          const url = relative.startsWith(".") ? relative : `./${relative}`;
          return `url(${quote(url)}) format(${quote(format)})`;
        })
        .join(", ");
      rules.push(
        [
          "@font-face {",
          `  font-family: ${quote(family.name)};`,
          `  font-style: ${face.style};`,
          `  font-weight: ${face.weight};`,
          `  font-display: ${family.display};`,
          `  src: ${src};`,
          face.unicodeRange ? `  unicode-range: ${face.unicodeRange};` : "",
          "}",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }

  const variables = fonts
    .map(({ family }) => `  --font-${family.alias}: ${fontStack(family)};`)
    .join("\n");
  const css = rules.join("\n\n") + "\n";
  if (!variables) return { css, theme: "" };
  return tailwind
    ? { css, theme: `@theme {\n${variables}\n}\n` }
    : { css: `${css}\n:root {\n${variables}\n}\n`, theme: "" };
}
