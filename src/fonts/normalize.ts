import {
  FONT_PROVIDERS,
  type FontFamily,
  type FontStyle,
  type FontWeight,
  type ResolvedFontFamily,
} from "./types";

const DISPLAYS = ["auto", "block", "swap", "fallback", "optional"];
const STYLES = ["normal", "italic"];
const ALIAS = /^[a-z0-9][a-z0-9-]*$/;
const UNSAFE_CSS = /[;{}\n\r]/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function weightOf(weight: FontWeight, where: string): string {
  const value = String(weight).trim().toLowerCase();
  if (value === "normal") return "400";
  if (value === "bold") return "700";
  const parts = value.split(/\s+/);
  const valid =
    (parts.length === 1 || parts.length === 2) &&
    parts.every((part) => /^\d+$/.test(part) && +part >= 1 && +part <= 1000);
  if (!valid || (parts.length === 2 && +parts[0]! >= +parts[1]!)) {
    throw new Error(
      `[noofpi] ${where}: invalid weight "${String(weight)}" (use 1-1000, "normal", "bold" or a range like "100 900")`,
    );
  }
  return parts.join(" ");
}

function styleOf(style: unknown, where: string): FontStyle {
  if (!STYLES.includes(style as string)) {
    throw new Error(
      `[noofpi] ${where}: style must be "normal" or "italic" (got "${String(style)}")`,
    );
  }
  return style as FontStyle;
}

function list<T>(value: T | T[] | undefined, fallback: T): T[] {
  const values =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return [...new Set(values.length ? values : [fallback])];
}

/** Validates `fonts.families` and fills in defaults */
export function normalizeFonts(
  families: FontFamily[] | undefined,
): ResolvedFontFamily[] {
  if (families === undefined) return [];
  if (!Array.isArray(families)) {
    throw new Error("[noofpi] fonts.families must be an array");
  }

  const aliases = new Set<string>();
  return families.map((input, index) => {
    const where = `fonts.families[${index}]`;
    if (!input || typeof input !== "object") {
      throw new Error(`[noofpi] ${where} must be an object`);
    }
    if (!FONT_PROVIDERS.includes(input.provider)) {
      throw new Error(
        `[noofpi] ${where}.provider must be one of ${FONT_PROVIDERS.join(", ")} (got "${String(input.provider)}")`,
      );
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new Error(`[noofpi] ${where}.name is required`);

    const label = `${where} ("${name}")`;
    const display = input.display ?? "swap";
    if (!DISPLAYS.includes(display)) {
      throw new Error(
        `[noofpi] ${label}: display must be one of ${DISPLAYS.join(", ")} (got "${String(display)}")`,
      );
    }
    const fallback = input.fallback ?? [];
    if (
      !Array.isArray(fallback) ||
      fallback.some((f) => typeof f !== "string" || UNSAFE_CSS.test(f))
    ) {
      throw new Error(
        `[noofpi] ${label}: fallback must be an array of font names`,
      );
    }
    const alias = input.alias ?? slugify(name);
    if (!ALIAS.test(alias)) {
      throw new Error(
        `[noofpi] ${label}: alias "${alias}" must be kebab-case (set \`alias\` explicitly)`,
      );
    }
    if (aliases.has(alias)) {
      throw new Error(
        `[noofpi] ${label}: alias "${alias}" is already used, set a unique \`alias\``,
      );
    }
    aliases.add(alias);

    const resolved: ResolvedFontFamily = {
      provider: input.provider,
      name,
      display,
      fallback,
      alias,
      weights: [],
      styles: [],
      subsets: [],
      files: [],
    };

    if (input.provider === "google") {
      resolved.weights = list<FontWeight>(input.weight, 400).map((w) =>
        weightOf(w, label),
      );
      resolved.styles = list<FontStyle>(input.style, "normal").map((s) =>
        styleOf(s, label),
      );
      resolved.subsets = input.subsets ?? [];
    } else {
      if (Array.isArray(input.weight)) {
        throw new Error(
          `[noofpi] ${label}: local fonts take a single weight; give each file its own weight in \`src\``,
        );
      }
      const weight = weightOf(input.weight ?? 400, label);
      const style = styleOf(input.style ?? "normal", label);
      const files =
        typeof input.src === "string" ? [{ src: input.src }] : input.src;
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error(
          `[noofpi] ${label}: src is required (a file path or a list of files)`,
        );
      }
      resolved.files = files.map((file, i) => {
        if (!file || typeof file.src !== "string" || !file.src) {
          throw new Error(`[noofpi] ${label}: src[${i}].src is required`);
        }
        const { weight: fileWeight, style: fileStyle } = file as {
          weight?: FontWeight;
          style?: FontStyle;
        };
        return {
          src: file.src,
          weight:
            fileWeight === undefined ? weight : weightOf(fileWeight, label),
          style: fileStyle === undefined ? style : styleOf(fileStyle, label),
        };
      });
    }
    return resolved;
  });
}
