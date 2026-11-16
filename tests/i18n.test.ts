import { describe, expect, it } from "vitest";
import { createCookieJar } from "../src/cookies";
import {
  formatMessage,
  LOCALE_COOKIE,
  matchLocale,
  parseAcceptLanguage,
  pickLocale,
  resolveI18n,
  textDirection,
  translate,
} from "../src/i18n";
import {
  catalogFromFiles,
  createI18n,
  defineMessages,
  type LocaleMessages,
} from "../src/runtime/i18n";
import { i18nTypes } from "../src/vite/types";

const en = defineMessages({
  hello: "Hello {name}",
  home: { title: "Home" },
  items: "no items | one item | {count} items",
  plain: "Plain",
});

declare module "../src/runtime/doofpi-client" {
  interface Register {
    messages: typeof en;
    locales: "en" | "he";
  }
}

// Compile-time checks: `tsc` fails when a `@ts-expect-error` line stops being an error
export function typeChecks() {
  const { t } = createI18n({
    config: { locales: ["en", "he"], defaultLocale: "en" },
    catalog: {},
    locale: "en",
    cookies: createCookieJar(),
  });
  t("hello", { name: "Ada" });
  t("home.title");
  t("items", { count: 3 });
  // @ts-expect-error unknown key
  t("home.missing");
  // @ts-expect-error a group is not a message
  t("home");
  // @ts-expect-error params are required
  t("hello");
  // @ts-expect-error wrong param name
  t("hello", { who: "Ada" });
  const he = defineMessages({
    hello: "שלום {name}",
    home: { title: "בית" },
    items: "",
    plain: "",
  }) satisfies LocaleMessages<typeof en>;
  // @ts-expect-error a locale must have every key of the default one
  defineMessages({ hello: "" }) satisfies LocaleMessages<typeof en>;
  return he;
}

describe("resolveI18n", () => {
  it("is off without config and defaults to the first locale", () => {
    expect(resolveI18n(undefined)).toBeUndefined();
    expect(resolveI18n({ locales: ["he", "en"] })).toEqual({
      locales: ["he", "en"],
      defaultLocale: "he",
    });
  });

  it("rejects bad config", () => {
    expect(() => resolveI18n({ locales: [] })).toThrow(/at least one/);
    expect(() => resolveI18n({ locales: ["en", "../x"] })).toThrow(
      /language tags/,
    );
    expect(() => resolveI18n({ locales: ["en", "EN"] })).toThrow(/duplicates/);
    expect(() => resolveI18n({ locales: ["en"], defaultLocale: "he" })).toThrow(
      /defaultLocale "he"/,
    );
  });
});

describe("locale detection", () => {
  const locales = ["en", "he", "pt-BR"];

  it("matches by tag, language and region", () => {
    expect(matchLocale(["HE"], locales)).toBe("he");
    expect(matchLocale(["he-IL"], locales)).toBe("he");
    expect(matchLocale(["pt"], locales)).toBe("pt-BR");
    expect(matchLocale(["fr", "en-US"], locales)).toBe("en");
    expect(matchLocale(["fr", undefined], locales)).toBeUndefined();
  });

  it("orders Accept-Language by quality", () => {
    expect(parseAcceptLanguage("en;q=0.5, he, *;q=0.1, fr;q=0")).toEqual([
      "he",
      "en",
    ]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });

  it("prefers the saved locale, then the browser's, then the default", () => {
    const config = { locales, defaultLocale: "en" };
    expect(pickLocale(config, { saved: "he", preferred: ["pt"] })).toBe("he");
    expect(pickLocale(config, { saved: "xx", preferred: ["pt"] })).toBe(
      "pt-BR",
    );
    expect(pickLocale(config, { preferred: ["fr"] })).toBe("en");
  });

  it("knows right-to-left languages", () => {
    expect(textDirection("he")).toBe("rtl");
    expect(textDirection("ar-EG")).toBe("rtl");
    expect(textDirection("en")).toBe("ltr");
  });
});

describe("messages", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(formatMessage("Hi { name }, {x}", { name: "Ada" })).toBe(
      "Hi Ada, {x}",
    );
  });

  it("picks plural forms by count", () => {
    const items = "no items | one item | {count} items";
    expect(formatMessage(items, { count: 0 })).toBe("no items");
    expect(formatMessage(items, { count: 1 })).toBe("one item");
    expect(formatMessage(items, { count: 4 })).toBe("4 items");
    expect(formatMessage("car | cars", { count: 1 })).toBe("car");
    expect(formatMessage("car | cars", { count: 2 })).toBe("cars");
    expect(formatMessage("a | b")).toBe("a | b");
  });

  it("falls back to the default locale, then to the key", () => {
    const catalog = { en: { a: "A", n: { b: "B" } }, he: { a: "א" } };
    expect(translate(catalog, "he", "en", "a")).toBe("א");
    expect(translate(catalog, "he", "en", "n.b")).toBe("B");
    expect(translate(catalog, "he", "en", "n")).toBe("n");
    expect(translate(catalog, "he", "en", "nope.x")).toBe("nope.x");
    expect(translate(catalog, "he", "en", "__proto__.x")).toBe("__proto__.x");
  });

  it("maps locale files to locales", () => {
    expect(
      catalogFromFiles(
        { "/app/locales/en.ts": { a: "A" }, "/app/locales/xx.json": {} },
        ["en", "he"],
      ),
    ).toEqual({ en: { a: "A" } });
  });
});

describe("createI18n", () => {
  it("switches the locale reactively and remembers it in a cookie", () => {
    const cookies = createCookieJar();
    const i18n = createI18n({
      config: { locales: ["en", "he"], defaultLocale: "en" },
      catalog: { en: { hi: "Hi" }, he: { hi: "שלום" } },
      locale: "en",
      cookies,
    });
    expect(i18n.t("hi" as never)).toBe("Hi");
    i18n.setLocale("he");
    expect(i18n.locale.value).toBe("he");
    expect(i18n.t("hi" as never)).toBe("שלום");
    expect(cookies.get(LOCALE_COOKIE)).toBe("he");
    expect(() => i18n.setLocale("fr" as never)).toThrow(/Unknown locale/);
  });

  it("loads a locale on demand before switching to it", async () => {
    const cookies = createCookieJar();
    let loads = 0;
    const i18n = createI18n({
      config: { locales: ["en", "he"], defaultLocale: "en" },
      catalog: {},
      loaders: {
        en: async () => ({ hi: "Hi", only: "Only" }),
        he: async () => {
          loads++;
          return { hi: "שלום" };
        },
      },
      locale: "en",
      cookies,
    });
    await i18n.ready;
    expect(i18n.t("hi" as never)).toBe("Hi");
    const switching = i18n.setLocale("he");
    expect(i18n.locale.value).toBe("en");
    await switching;
    expect(i18n.locale.value).toBe("he");
    expect(i18n.t("hi" as never)).toBe("שלום");
    expect(i18n.t("only" as never)).toBe("Only");
    expect(cookies.get(LOCALE_COOKIE)).toBe("he");
    await i18n.setLocale("en");
    await i18n.setLocale("he");
    expect(loads).toBe(1);
  });

  it("keeps the last requested locale and the current one when loading fails", async () => {
    let offline = true;
    const i18n = createI18n({
      config: { locales: ["en", "he"], defaultLocale: "en" },
      catalog: { en: { hi: "Hi" } },
      loaders: {
        he: async () => {
          if (offline) throw new Error("offline");
          return { hi: "שלום" };
        },
      },
      locale: "en",
      cookies: createCookieJar(),
    });
    await expect(i18n.setLocale("he")).rejects.toThrow("offline");
    expect(i18n.locale.value).toBe("en");
    offline = false;
    const slow = i18n.setLocale("he");
    await i18n.setLocale("en");
    await slow;
    expect(i18n.locale.value).toBe("en");
  });
});

describe("i18nTypes", () => {
  const config = { locales: ["en", "he"], defaultLocale: "en" };

  it("registers the locales and the default locale's messages", () => {
    const dts = i18nTypes(config, "app/locales/en.ts");
    expect(dts).toContain('import type messages from "../app/locales/en";');
    expect(dts).toContain("messages: typeof messages;");
    expect(dts).toContain('locales: "en" | "he";');
  });

  it("keeps the extension of a JSON file and works without a file", () => {
    expect(i18nTypes(config, "app/locales/en.json")).toContain(
      '"../app/locales/en.json"',
    );
    expect(i18nTypes(config)).not.toContain("messages");
  });
});
