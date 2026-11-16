/** Built-in font providers. To add one, extend this list and register it in `providers/index.ts` */
export const FONT_PROVIDERS = ["google", "local"] as const;
export type FontProviderName = (typeof FONT_PROVIDERS)[number];

/** `400`, `"bold"`, or a variable range like `"100 900"` */
export type FontWeight = number | string;
export type FontStyle = "normal" | "italic";
export type FontDisplay = "auto" | "block" | "swap" | "fallback" | "optional";

interface FontFamilyBase {
  /** CSS font-family name, e.g. `Inter` */
  name: string;
  /** `font-display` (default: `swap`) */
  display?: FontDisplay;
  /** Fallback fonts appended after `name`, e.g. `["ui-sans-serif", "sans-serif"]` */
  fallback?: string[];
  /**
   * Theme key: gives the Tailwind `font-<alias>` utility and the `--font-<alias>` CSS variable.
   * Default: the kebab-cased `name` (`Open Sans` -> `font-open-sans`). Use `sans`, `serif` or `mono` to replace
   * Tailwind's default stacks
   */
  alias?: string;
}

/** Downloaded at dev/build time and self-hosted (cached in `.noofpi/fonts`) */
export interface GoogleFontFamily extends FontFamilyBase {
  provider: "google";
  /** Weights to load (default: `400`). A range like `"100 900"` loads the variable font */
  weight?: FontWeight | FontWeight[];
  /** Default: `normal` */
  style?: FontStyle | FontStyle[];
  /** Google subsets to include, e.g. `["latin", "hebrew"]` (default: all; browsers only download what the page uses) */
  subsets?: string[];
}

export interface LocalFontFile {
  /** Path relative to the project root, e.g. `app/assets/fonts/Inter.woff2` */
  src: string;
  weight?: FontWeight;
  style?: FontStyle;
}

/** Font files from your project (woff2, woff, ttf, otf) */
export interface LocalFontFamily extends FontFamilyBase {
  provider: "local";
  /** One file, or one entry per weight/style */
  src: string | LocalFontFile[];
  /** Default weight of `src` entries (default: `400`) */
  weight?: FontWeight;
  /** Default style of `src` entries (default: `normal`) */
  style?: FontStyle;
}

export type FontFamily = GoogleFontFamily | LocalFontFamily;

export interface FontsConfig {
  families: FontFamily[];
}

export interface ResolvedFontFamily {
  provider: FontProviderName;
  name: string;
  display: FontDisplay;
  fallback: string[];
  alias: string;
  /** google */
  weights: string[];
  styles: FontStyle[];
  subsets: string[];
  /** local */
  files: { src: string; weight: string; style: FontStyle }[];
}

/** One `@font-face`, with its files already on disk */
export interface FontFaceDescriptor {
  weight: string;
  style: FontStyle;
  unicodeRange?: string;
  sources: { file: string; format: string }[];
}

export interface FontProviderContext {
  root: string;
  /** Where providers keep downloaded files */
  cacheDir: string;
  fetch: typeof fetch;
}

export interface FontProvider {
  resolve(
    family: ResolvedFontFamily,
    context: FontProviderContext,
  ): Promise<FontFaceDescriptor[]>;
}
