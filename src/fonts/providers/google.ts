import path from "node:path";
import type {
  FontFaceDescriptor,
  FontProvider,
  FontStyle,
  ResolvedFontFamily,
} from "../types";
import { cachedFile, cachedText } from "./cache";
import { formatOf } from "./format";

// Google serves woff2 (split per unicode subset) only to modern browsers
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The Google Fonts CSS2 API URL for a family. Axis tuples have to be sorted or the API rejects the request */
export function googleCssUrl(family: ResolvedFontFamily): string {
  const weights = family.weights
    .map((w) => w.replace(" ", ".."))
    .sort((a, b) => parseInt(a) - parseInt(b));
  const italic = family.styles.includes("italic");
  const tuples: string[] = [];
  for (const style of ["normal", "italic"] as const) {
    if (!family.styles.includes(style)) continue;
    for (const weight of weights) {
      tuples.push(italic ? `${style === "italic" ? 1 : 0},${weight}` : weight);
    }
  }
  const name = encodeURIComponent(family.name).replace(/%20/g, "+");
  const axes = italic ? "ital,wght" : "wght";
  return `https://fonts.googleapis.com/css2?family=${name}:${axes}@${tuples.join(";")}&display=swap`;
}

export interface GoogleFace {
  subset?: string;
  weight: string;
  style: FontStyle;
  unicodeRange?: string;
  sources: { url: string; format?: string }[];
}

/** Reads the `@font-face` blocks of a Google Fonts CSS response (each is preceded by a comment naming its subset) */
export function parseGoogleCss(css: string): GoogleFace[] {
  const faces: GoogleFace[] = [];
  const block = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(block)) {
    const declarations = new Map<string, string>();
    for (const d of match[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      declarations.set(d[1]!.toLowerCase(), d[2]!.trim());
    }
    const sources = [
      ...(declarations.get("src") ?? "").matchAll(
        /url\(\s*(['"]?)([^)'"]+)\1\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/g,
      ),
    ].map((s) => ({ url: s[2]!, format: s[3] }));
    if (sources.length === 0) continue;
    faces.push({
      subset: match[1] || undefined,
      weight: declarations.get("font-weight") ?? "400",
      style: declarations.get("font-style") === "italic" ? "italic" : "normal",
      unicodeRange: declarations.get("unicode-range"),
      sources,
    });
  }
  return faces;
}

export const googleProvider: FontProvider = {
  async resolve(family, context) {
    const url = googleCssUrl(family);
    let css: string;
    try {
      css = await cachedText(context, url, { "user-agent": USER_AGENT });
    } catch (error) {
      throw new Error(
        `[noofpi] Could not load Google font "${family.name}": ${(error as Error).message}`,
        { cause: error },
      );
    }

    const all = parseGoogleCss(css);
    const faces = all.filter(
      (face) =>
        !face.subset ||
        family.subsets.length === 0 ||
        family.subsets.includes(face.subset),
    );
    if (faces.length === 0) {
      const available = [...new Set(all.map((f) => f.subset))].join(", ");
      throw new Error(
        `[noofpi] Google font "${family.name}" has no subset matching [${family.subsets.join(", ")}] (available: ${available || "none"})`,
      );
    }

    return Promise.all(
      faces.map(async (face): Promise<FontFaceDescriptor> => {
        const sources = await Promise.all(
          face.sources.map(async (source) => {
            const ext = path.extname(new URL(source.url).pathname) || ".woff2";
            try {
              return {
                file: await cachedFile(context, source.url, ext),
                format: source.format ?? formatOf(ext) ?? "woff2",
              };
            } catch (error) {
              throw new Error(
                `[noofpi] Could not download Google font "${family.name}": ${(error as Error).message}`,
                { cause: error },
              );
            }
          }),
        );
        return {
          weight: face.weight,
          style: face.style,
          unicodeRange: face.unicodeRange,
          sources,
        };
      }),
    );
  },
};
