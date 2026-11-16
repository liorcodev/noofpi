import { customRef, inject, type InjectionKey, type Ref } from "vue";
import {
  createCookieJar,
  mergeCookieOptions,
  stringCodec,
  type CookieCodec,
  type CookieDefinition,
  type CookieJar,
  type CookieOptions,
} from "../cookies";

export const COOKIES_KEY: InjectionKey<CookieJar> = Symbol("noofpi:cookies");

/** Reads and writes `document.cookie` */
export function createBrowserCookieJar(): CookieJar {
  return createCookieJar({
    cookie: () => document.cookie,
    defaults: { secure: location.protocol === "https:" },
    write: (header) => {
      document.cookie = header;
    },
  });
}

/**
 * The cookie jar of the current request: on the server it holds the request's cookies and what you set goes out with
 * the response; in the browser it is `document.cookie`. HttpOnly cookies are only visible on the server.
 * Call it inside `setup()` (or `app.runWithContext`, e.g. in route middleware).
 */
export function useCookies(): CookieJar {
  const jar = inject(COOKIES_KEY, null);
  if (!jar)
    throw new Error(
      "[noofpi] useCookies() must be called inside setup() or app.runWithContext()",
    );
  return jar;
}

export interface UseCookieOptions<T> extends CookieOptions {
  /** Value while the cookie is not set. It is not written until you assign a value. */
  default?: () => T;
}

export interface UseCookieCodecOptions<T> extends UseCookieOptions<T> {
  /** Wraps the cookie value in your own type, see `jsonCodec`, `enumCodec` or write one (`encode` / `decode`) */
  codec: CookieCodec<T>;
}

/**
 * A cookie as a ref: assigning writes the cookie (`undefined` / `null` removes it), on the server and in the browser.
 * The server renders with the request's value, so SSR and hydration agree. Assign a new value instead of mutating
 * an object in place. Cookies set from the browser are never HttpOnly. A value the codec cannot decode counts as
 * not set. Pass a `defineCookie()` definition to share name, type and options with server code.
 */
export function useCookie(
  name: string,
  options: UseCookieOptions<string> & { default: () => string },
): Ref<string>;
export function useCookie(
  name: string,
  options?: UseCookieOptions<string>,
): Ref<string | undefined>;
export function useCookie<T>(
  name: string,
  options: UseCookieCodecOptions<T> & { default: () => T },
): Ref<T>;
export function useCookie<T>(
  name: string,
  options: UseCookieCodecOptions<T>,
): Ref<T | undefined>;
export function useCookie<T>(
  cookie: CookieDefinition<T>,
  options: UseCookieOptions<T> & { default: () => T },
): Ref<T>;
export function useCookie<T>(
  cookie: CookieDefinition<T>,
  options?: UseCookieOptions<T>,
): Ref<T | undefined>;
export function useCookie(
  target: string | CookieDefinition<any>,
  options: UseCookieOptions<any> & { codec?: CookieCodec<any> } = {},
): Ref<any> {
  const jar = useCookies();
  const { default: getDefault, codec, ...cookieOptions } = options;
  const cookie: CookieDefinition<any> =
    typeof target === "string"
      ? { name: target, codec: codec ?? stringCodec, options: {} }
      : target;
  // The server may write it too, so it has to stay readable for the browser unless the caller says otherwise
  const writeOptions = mergeCookieOptions(
    { httpOnly: false },
    cookie.options,
    cookieOptions,
  );
  let value = jar.get(cookie) ?? getDefault?.();

  return customRef((track, trigger) => ({
    get() {
      track();
      return value;
    },
    set(next) {
      value = next;
      if (next === undefined || next === null)
        jar.remove(cookie, {
          path: writeOptions.path,
          domain: writeOptions.domain,
        });
      else jar.set(cookie, next, writeOptions);
      trigger();
    },
  }));
}
