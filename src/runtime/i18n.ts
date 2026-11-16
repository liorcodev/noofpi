import { inject, ref, shallowReactive, type InjectionKey, type Ref } from "vue";
import type { CookieJar } from "../cookies";
import {
  LOCALE_COOKIE,
  translate,
  type MessageParamValue,
  type Messages,
  type ResolvedI18n,
} from "../i18n";
import type { Register } from "./doofpi-client";

export type { Messages, MessageParamValue };

/**
 * The messages of the default locale, registered through {@link Register}. Filled in by the `.noofpi/i18n.d.ts` that
 * noofpi generates from `app/locales/<defaultLocale>`. `never` without it.
 */
export type RegisteredMessages = Register extends {
  messages: infer M extends Messages;
}
  ? M
  : never;

/** The locales of `i18n.locales` (generated into `.noofpi/i18n.d.ts`), `string` without it */
export type Locale = Register extends { locales: infer L extends string }
  ? L
  : string;

type MessagePaths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends object
      ? MessagePaths<T[K], `${P}${K}.`>
      : never;
}[keyof T & string];

type MessageAt<T, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? MessageAt<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

type Trim<S extends string> = S extends ` ${infer R}`
  ? Trim<R>
  : S extends `${infer R} `
    ? Trim<R>
    : S;

type Placeholders<S extends string> =
  S extends `${string}{${infer N}}${infer Rest}`
    ? Trim<N> | Placeholders<Rest>
    : never;

/** Dotted paths of every message, e.g. `"home.title"`. Any `string` without the generated types */
export type MessageKey = [RegisteredMessages] extends [never]
  ? string
  : MessagePaths<RegisteredMessages>;

type LooseParams = Record<string, MessageParamValue>;

/** The `{name}` placeholders of a message are required, typed params (when its text is a literal, see `defineMessages`) */
export type MessageArgs<K extends string> = [RegisteredMessages] extends [never]
  ? [params?: LooseParams]
  : MessageAt<RegisteredMessages, K> extends infer M extends string
    ? string extends M
      ? [params?: LooseParams]
      : [Placeholders<M>] extends [never]
        ? [params?: { count?: number }]
        : [params: Record<Placeholders<M>, MessageParamValue>]
    : [params?: LooseParams];

export type TranslateFunction = <K extends MessageKey>(
  key: K,
  ...args: MessageArgs<K>
) => string;

/** The shape another locale has to follow: the same keys as `T` (the default locale), any text */
export type LocaleMessages<T> = {
  [K in keyof T]: T[K] extends string ? string : LocaleMessages<T[K]>;
};

/**
 * Identity function that keeps the message texts as literal types, so `t("hello", { name })` knows its params:
 * `export default defineMessages({ hello: "Hi {name}" })`. Make other locales follow the default one with
 * `satisfies LocaleMessages<typeof en>`.
 */
export function defineMessages<const T extends Messages>(messages: T): T {
  return messages;
}

export interface I18n {
  /** The active locale (reactive) */
  locale: Readonly<Ref<Locale>>;
  locales: readonly Locale[];
  defaultLocale: Locale;
  /** The message of the active locale (the default locale's when it lacks it, else the key); `{name}` placeholders are filled from `params` and `one | many` forms picked by `params.count` */
  t: TranslateFunction;
  /**
   * Switches the locale and remembers it in a cookie. In the browser the locale's messages are loaded on demand, so the
   * switch happens once they arrived (the promise rejects, and the locale stays, when loading fails).
   */
  setLocale: (locale: Locale) => Promise<void>;
  /** Settles when the messages of the initial locale (and of the default one, the fallback) are loaded */
  ready: Promise<void>;
}

export const I18N_KEY: InjectionKey<I18n> = Symbol("noofpi:i18n");

/** `/app/locales/en.ts` -> `en` */
export function catalogFromFiles<T>(
  files: Record<string, T>,
  locales: readonly string[],
): Record<string, T> {
  const catalog: Record<string, T> = {};
  for (const [file, value] of Object.entries(files)) {
    const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    const locale = locales.find((candidate) => candidate === name);
    if (locale) catalog[locale] = value;
  }
  return catalog;
}

export function createI18n(options: {
  config: ResolvedI18n;
  /** The messages that are already at hand */
  catalog: Record<string, Messages>;
  /** Fetches the messages of a locale that is not in `catalog` (the browser's lazy locale files) */
  loaders?: Record<string, () => Promise<Messages>>;
  /** The locale to start with, one of `config.locales` */
  locale: string;
  cookies: CookieJar;
}): I18n {
  const { config, cookies, loaders = {} } = options;
  const catalog = shallowReactive<Record<string, Messages>>({
    ...options.catalog,
  });
  const locale = ref(options.locale);
  const t = (key: string, params?: LooseParams) =>
    translate(catalog, locale.value, config.defaultLocale, key, params);

  const loading = new Map<string, Promise<void>>();
  const load = (target: string): Promise<void> => {
    const loader = loaders[target];
    if (Object.hasOwn(catalog, target) || !loader) return Promise.resolve();
    let pending = loading.get(target);
    if (!pending) {
      pending = loader()
        .then((messages) => {
          catalog[target] = messages;
        })
        .finally(() => loading.delete(target));
      loading.set(target, pending);
    }
    return pending;
  };
  const apply = (next: string) => {
    locale.value = next;
    // The server may read it too, so it stays readable for the browser
    cookies.set(LOCALE_COOKIE, next, {
      maxAge: 60 * 60 * 24 * 365,
      httpOnly: false,
    });
  };

  let latest = 0;
  return {
    locale,
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    t: t as TranslateFunction,
    ready: Promise.all([load(config.defaultLocale), load(options.locale)]).then(
      () => undefined,
    ),
    setLocale(next) {
      if (!config.locales.includes(next))
        throw new Error(
          `[noofpi] Unknown locale "${next}", expected one of ${config.locales.join(", ")}`,
        );
      const request = ++latest;
      if (Object.hasOwn(catalog, next) || !loaders[next]) {
        apply(next);
        return Promise.resolve();
      }
      // A newer call wins when the user switches again while this one is loading
      return load(next).then(() => {
        if (request === latest) apply(next);
      });
    },
  } as I18n;
}

/**
 * The i18n of the app (configured by `i18n` in `noofpi.config.ts`): `t()` translates, `locale` is the active locale and
 * `setLocale()` switches it. Call it inside `setup()` (or `app.runWithContext`). Message keys and params are
 * typed by the generated `.noofpi/i18n.d.ts`.
 */
export function useI18n(): I18n {
  const i18n = inject(I18N_KEY, null);
  if (!i18n)
    throw new Error(
      "[noofpi] useI18n() needs `i18n: { locales: [...] }` in noofpi.config.ts and must be called inside setup()",
    );
  return i18n;
}

declare module "vue" {
  interface ComponentCustomProperties {
    /** Same as `useI18n().t` */
    $t: TranslateFunction;
  }
}
