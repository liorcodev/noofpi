export interface CookieOptions {
  /** Lifetime in seconds. Without `maxAge` / `expires` the cookie lasts for the browser session */
  maxAge?: number;
  expires?: Date;
  domain?: string;
  /** Default: `/` */
  path?: string;
  /** Default: `true` over https. Forced on for `SameSite=None`, `Partitioned` and `__Secure-` / `__Host-` names */
  secure?: boolean;
  /** Hides the cookie from `document.cookie`. Default on the server: `true`. Cannot be set from the browser. */
  httpOnly?: boolean;
  /** Default: `lax` */
  sameSite?: "lax" | "strict" | "none";
  partitioned?: boolean;
}

/** Converts a typed value to the cookie's string value and back. `decode` throws on a value it does not accept. */
export interface CookieCodec<T> {
  encode(value: T): string;
  decode(raw: string): T;
}

/** A named, typed cookie that can be shared by server code and components */
export interface CookieDefinition<T> {
  name: string;
  codec: CookieCodec<T>;
  options: CookieOptions;
}

export const stringCodec: CookieCodec<string> = {
  encode: (value) => value,
  decode: (raw) => raw,
};

export const numberCodec: CookieCodec<number> = {
  encode: (value) => String(value),
  decode: (raw) => {
    const value = Number(raw);
    if (raw.trim() === "" || Number.isNaN(value))
      throw new Error(`Not a number: ${raw}`);
    return value;
  },
};

export const booleanCodec: CookieCodec<boolean> = {
  encode: (value) => (value ? "true" : "false"),
  decode: (raw) => {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Not a boolean: ${raw}`);
  },
};

/** JSON for objects, arrays and anything else `JSON.stringify` handles. The type is not validated at runtime. */
export function jsonCodec<T>(): CookieCodec<T> {
  return {
    encode: (value) => JSON.stringify(value),
    decode: (raw) => JSON.parse(raw) as T,
  };
}

/** A string union: any other cookie value counts as absent */
export function enumCodec<const T extends string>(
  values: readonly T[],
): CookieCodec<T> {
  return {
    encode: (value) => value,
    decode: (raw) => {
      if (!(values as readonly string[]).includes(raw))
        throw new Error(`Unexpected value: ${raw}`);
      return raw as T;
    },
  };
}

export function defineCookie(
  name: string,
  options?: CookieOptions,
): CookieDefinition<string>;
export function defineCookie<T>(
  name: string,
  options: CookieOptions & { codec: CookieCodec<T> },
): CookieDefinition<T>;
export function defineCookie(
  name: string,
  options: CookieOptions & { codec?: CookieCodec<any> } = {},
): CookieDefinition<any> {
  const { codec, ...rest } = options;
  return { name, codec: codec ?? stringCodec, options: rest };
}

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Parses a `Cookie` header. The first cookie of a name wins (browsers send the most specific path first). */
export function parseCookies(
  header: string | null | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null);
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    cookies[name] = safeDecode(value);
  }
  return cookies;
}

const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ATTRIBUTE = /^[\x20-\x3a\x3c-\x7e]+$/; // printable ASCII, no ";"
const MAX_SIZE = 4096;

/** Merges option layers left to right; `undefined` values never override */
export function mergeCookieOptions(
  ...layers: (CookieOptions | undefined)[]
): CookieOptions {
  const merged: Record<string, unknown> = {};
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer ?? {}))
      if (value !== undefined) merged[key] = value;
  return merged as CookieOptions;
}

/** Builds a `Set-Cookie` header value. `value` is percent-encoded here; invalid names and attributes throw. */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  if (!NAME.test(name))
    throw new Error(`[noofpi] Invalid cookie name: ${name}`);
  const pair = `${name}=${encodeURIComponent(value)}`;
  if (new TextEncoder().encode(pair).length > MAX_SIZE)
    throw new Error(
      `[noofpi] Cookie "${name}" is larger than ${MAX_SIZE} bytes, browsers would drop it`,
    );
  const { maxAge, expires, domain, path, httpOnly, sameSite, partitioned } =
    options;
  const secure =
    options.secure ||
    sameSite === "none" ||
    partitioned ||
    name.startsWith("__Secure-") ||
    name.startsWith("__Host-");
  const parts = [pair];
  if (path !== undefined) {
    if (!ATTRIBUTE.test(path))
      throw new Error(`[noofpi] Invalid cookie path: ${path}`);
    parts.push(`Path=${path}`);
  }
  if (domain !== undefined) {
    if (!ATTRIBUTE.test(domain))
      throw new Error(`[noofpi] Invalid cookie domain: ${domain}`);
    parts.push(`Domain=${domain}`);
  }
  if (maxAge !== undefined) {
    if (!Number.isFinite(maxAge))
      throw new Error(`[noofpi] Invalid cookie maxAge: ${maxAge}`);
    parts.push(`Max-Age=${Math.trunc(maxAge)}`);
  }
  if (expires !== undefined) {
    if (Number.isNaN(expires.getTime()))
      throw new Error("[noofpi] Invalid cookie expires date");
    parts.push(`Expires=${expires.toUTCString()}`);
  }
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (sameSite)
    parts.push(
      `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`,
    );
  if (partitioned) parts.push("Partitioned");
  return parts.join("; ");
}

export interface CookieJarInit {
  /** The request's `Cookie` header, or a function that reads it each time (the browser's `document.cookie`) */
  cookie?: string | null | (() => string | null | undefined);
  /** Applied under the options of each `set` / `remove` */
  defaults?: CookieOptions;
  /**
   * Called with each `Set-Cookie` value as soon as a cookie is written (the browser assigns it to
   * `document.cookie`). Without it, writes are queued for the response: see `CookieJar.toSetCookieHeaders`.
   */
  write?: (header: string) => void;
}

export interface CookieJar {
  has(name: string): boolean;
  get(name: string): string | undefined;
  get<T>(name: string, codec: CookieCodec<T>): T | undefined;
  get<T>(cookie: CookieDefinition<T>): T | undefined;
  /** Every cookie as its raw string value */
  getAll(): Record<string, string>;
  set(name: string, value: string, options?: CookieOptions): void;
  set<T>(
    name: string,
    value: T,
    options: CookieOptions & { codec: CookieCodec<T> },
  ): void;
  set<T>(cookie: CookieDefinition<T>, value: T, options?: CookieOptions): void;
  /** Expires the cookie. Pass the `path` / `domain` it was set with when they are not the defaults. */
  remove(
    cookie: string | CookieDefinition<any>,
    options?: Pick<CookieOptions, "path" | "domain">,
  ): void;
  /** `Set-Cookie` values queued by `set` / `remove`, for the response (empty when `write` is used) */
  toSetCookieHeaders(): string[];
}

/**
 * Reads the request's cookies and collects the changes. A cookie set or removed is visible to later reads at once.
 * The value type of a cookie comes from its codec (default: string).
 */
export function createCookieJar(init: CookieJarInit = {}): CookieJar {
  const { write } = init;
  const defaults = mergeCookieOptions(
    { path: "/", sameSite: "lax", httpOnly: true },
    init.defaults,
  );
  const source: () => Record<string, string> =
    typeof init.cookie === "function"
      ? (
          (header) => () =>
            parseCookies(header())
        )(init.cookie)
      : (
          (parsed) => () =>
            parsed
        )(parseCookies(init.cookie));
  const queue = new Map<string, string>();
  const overrides = new Map<string, string | null>();

  const read = (): Record<string, string> => {
    const all: Record<string, string> = Object.assign(
      Object.create(null),
      source(),
    );
    for (const [name, value] of overrides)
      if (value === null) delete all[name];
      else all[name] = value;
    return all;
  };

  const emit = (name: string, value: string | null, options: CookieOptions) => {
    // Scripts cannot create HttpOnly cookies, so a browser jar never asks for them
    const header = serializeCookie(
      name,
      value ?? "",
      write ? { ...options, httpOnly: false } : options,
    );
    if (write) {
      write(header);
      return;
    }
    queue.set(`${name}|${options.domain ?? ""}|${options.path ?? ""}`, header);
    overrides.set(name, value);
  };

  const definition = (
    target: string | CookieDefinition<any>,
    codec?: CookieCodec<any>,
  ): CookieDefinition<any> =>
    typeof target === "string"
      ? { name: target, codec: codec ?? stringCodec, options: {} }
      : target;

  return {
    has: (name) => name in read(),
    get(target: string | CookieDefinition<any>, codec?: CookieCodec<any>) {
      const cookie = definition(target, codec);
      const raw = read()[cookie.name];
      if (raw === undefined) return undefined;
      try {
        return cookie.codec.decode(raw);
      } catch {
        return undefined;
      }
    },
    getAll: () => ({ ...read() }),
    set(
      target: string | CookieDefinition<any>,
      value: unknown,
      options: CookieOptions & { codec?: CookieCodec<any> } = {},
    ) {
      const { codec, ...rest } = options;
      const cookie = definition(target, codec);
      emit(
        cookie.name,
        String(cookie.codec.encode(value)),
        mergeCookieOptions(defaults, cookie.options, rest),
      );
    },
    remove(target, options) {
      const cookie = definition(target);
      emit(
        cookie.name,
        null,
        mergeCookieOptions(defaults, cookie.options, options, {
          maxAge: 0,
          expires: new Date(0),
        }),
      );
    },
    toSetCookieHeaders: () => [...queue.values()],
  };
}

/** Appends the jar's queued cookies to the response (copying it when its headers are immutable) */
export function applyCookies(response: Response, jar: CookieJar): Response {
  const cookies = jar.toSetCookieHeaders();
  if (!cookies.length) return response;
  try {
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
