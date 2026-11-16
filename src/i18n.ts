/** Translations of one locale: nested objects with message strings as leaves */
export interface Messages {
  [key: string]: string | Messages;
}

export type MessageParamValue = string | number | boolean;

export interface I18nConfig {
  /** Every supported locale (BCP 47 tags such as `en`, `he`, `pt-BR`). Each one has a file `app/locales/<locale>.ts` (or `.js` / `.json`) */
  locales: string[];
  /** Used when nothing else matches and for messages a locale lacks. Default: the first of `locales` */
  defaultLocale?: string;
}

export interface ResolvedI18n {
  locales: string[];
  defaultLocale: string;
}

export const LOCALE_COOKIE = "noofpi-locale";

const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function resolveI18n(
  input: I18nConfig | undefined,
): ResolvedI18n | undefined {
  if (!input) return undefined;
  const { locales } = input;
  if (!Array.isArray(locales) || !locales.length)
    throw new Error("[noofpi] i18n.locales must list at least one locale");
  for (const locale of locales) {
    if (typeof locale !== "string" || !LOCALE_TAG.test(locale))
      throw new Error(
        `[noofpi] i18n.locales must be language tags such as "en" or "pt-BR" (got "${String(locale)}")`,
      );
  }
  if (
    new Set(locales.map((locale) => locale.toLowerCase())).size !==
    locales.length
  )
    throw new Error("[noofpi] i18n.locales must not contain duplicates");
  const defaultLocale = input.defaultLocale ?? locales[0]!;
  if (!locales.includes(defaultLocale))
    throw new Error(
      `[noofpi] i18n.defaultLocale "${defaultLocale}" must be one of i18n.locales (${locales.join(", ")})`,
    );
  return { locales: [...locales], defaultLocale };
}

const baseLanguage = (tag: string) => tag.split("-")[0]!.toLowerCase();

/**
 * The first candidate that a locale supports: an exact match (ignoring case), else the locale of its language
 * (`en-US` -> `en`), else any regional variant of it (`en` -> `en-GB`).
 */
export function matchLocale(
  candidates: readonly (string | undefined)[],
  locales: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    const found =
      locales.find((locale) => locale.toLowerCase() === lower) ??
      locales.find(
        (locale) => locale.toLowerCase() === baseLanguage(candidate),
      ) ??
      locales.find(
        (locale) => baseLanguage(locale) === baseLanguage(candidate),
      );
    if (found) return found;
  }
  return undefined;
}

/** `en-US,en;q=0.8,he;q=0.9` -> `["en-US", "he", "en"]` (best first, `q=0` and `*` dropped) */
export function parseAcceptLanguage(
  header: string | null | undefined,
): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(param)?.[1])
        .find((value) => value !== undefined);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter(({ tag, q }) => tag && tag !== "*" && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({ tag }) => tag);
}

/** The saved choice wins over the browser's preferences; the default locale is the last resort */
export function pickLocale(
  config: ResolvedI18n,
  sources: { saved?: string; preferred?: readonly string[] },
): string {
  return (
    matchLocale([sources.saved], config.locales) ??
    matchLocale(sources.preferred ?? [], config.locales) ??
    config.defaultLocale
  );
}

const RTL_LANGUAGES = new Set([
  "ar",
  "he",
  "fa",
  "ur",
  "ps",
  "sd",
  "ug",
  "yi",
  "dv",
  "ckb",
]);

export const textDirection = (locale: string): "ltr" | "rtl" =>
  RTL_LANGUAGES.has(baseLanguage(locale)) ? "rtl" : "ltr";

/** The message at a dotted path (`"home.title"`), `undefined` when missing or not a string */
export function lookupMessage(
  messages: Messages | undefined,
  key: string,
): string | undefined {
  let current: string | Messages | undefined = messages;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || !Object.hasOwn(current, part))
      return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Picks the form of `one | many` (two forms) or `none | one | many` (three) by `params.count`. Without a numeric
 * `count` the message is used as it is, so a `|` stays text.
 */
function selectPlural(
  message: string,
  count: MessageParamValue | undefined,
): string {
  if (typeof count !== "number" || !message.includes("|")) return message;
  const forms = message.split("|").map((form) => form.trim());
  if (forms.length === 2) return forms[count === 1 ? 0 : 1]!;
  const index = count === 0 ? 0 : count === 1 ? 1 : 2;
  return forms[Math.min(index, forms.length - 1)]!;
}

/** Fills the `{name}` placeholders; a placeholder without a param is left as it is */
export function formatMessage(
  message: string,
  params: Record<string, MessageParamValue> = {},
): string {
  return selectPlural(message, params.count).replace(
    /\{\s*(\w+)\s*\}/g,
    (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** The message of `locale`, else of the default locale, else the key itself */
export function translate(
  catalog: Record<string, Messages>,
  locale: string,
  defaultLocale: string,
  key: string,
  params?: Record<string, MessageParamValue>,
): string {
  const message =
    lookupMessage(catalog[locale], key) ??
    lookupMessage(catalog[defaultLocale], key);
  return message === undefined ? key : formatMessage(message, params);
}
