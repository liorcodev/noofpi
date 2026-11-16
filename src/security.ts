import { validateCsp, type CspConfig } from "./csp";

export interface CsrfConfig {
  /** Extra origins (`https://app.example.com`) allowed to send state-changing requests to the API. The site's own origin is always allowed */
  allowedOrigins?: string[];
  /** The site's public origin (`https://app.example.com`). When set, the `Origin` of a write must match it exactly, scheme included. Unset, only hosts are compared because a TLS-terminating proxy may hide https */
  publicOrigin?: string;
}

export interface SecurityConfig {
  /** `Content-Security-Policy` of every HTML page. A `'nonce'` source gets a per-request nonce, added to the page's scripts and styles automatically */
  csp?: CspConfig;
  /**
   * Security response headers added to every response that does not already set them. `false` turns them all off;
   * an object overrides single headers (`{ "X-Frame-Options": "DENY" }`) or removes one (`{ "Referrer-Policy": false }`).
   * Defaults: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` (skipped when the CSP has
   * `frame-ancestors`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone and
   * geolocation off) and, over https only, `Strict-Transport-Security`.
   */
  headers?: boolean | Record<string, string | false>;
  /**
   * Blocks cross-site state-changing requests (POST, PUT, PATCH, DELETE) to the doofpi API and the pfetch proxy by
   * checking `Origin` / `Sec-Fetch-Site`. On by default; `false` turns it off.
   */
  csrf?: boolean | CsrfConfig;
  /**
   * Largest request body in bytes the server accepts (for the doofpi API, the pfetch proxy and server middleware);
   * bigger ones get a `413`. Default 10 MiB (10485760); `false` turns it off.
   */
  bodyLimit?: number | false;
  /**
   * Hostnames (`app.example.com`, `app.example.com:8080` or `*.example.com` for any subdomain) the server answers to;
   * requests with another `Host` get a `400`. Not set by default: any host is accepted.
   */
  allowedHosts?: string[];
}

export interface ResolvedSecurity {
  csp?: CspConfig;
  headers: Record<string, string>;
  csrf: { allowedOrigins: string[]; publicOrigin?: string } | false;
  bodyLimit: number | false;
  allowedHosts?: string[];
}

const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024;

const HSTS = "Strict-Transport-Security";

const DEFAULT_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  [HSTS]: "max-age=15552000",
};

const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const FORBIDDEN_HEADER_VALUE = /[\u0000-\u001f\u007f]/;

/** Applies a `headers` option on top of already resolved headers (case-insensitive names, `false` removes) */
function overlayHeaders(
  base: Record<string, string>,
  input: SecurityConfig["headers"],
): Record<string, string> {
  if (input === false) return {};
  const merged: Record<string, string | false> = { ...base };
  if (input && typeof input === "object") {
    for (const [name, value] of Object.entries(input)) {
      if (!HEADER_NAME.test(name))
        throw new Error(
          `[noofpi] security.headers: "${name}" is not a valid header name`,
        );
      if (
        value !== false &&
        (typeof value !== "string" || FORBIDDEN_HEADER_VALUE.test(value))
      )
        throw new Error(
          `[noofpi] security.headers: "${name}" must be a string without control characters, or false`,
        );
      const existing = Object.keys(merged).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      );
      if (existing && existing !== name) delete merged[existing];
      merged[name] = value;
    }
  }
  return Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== false,
    ),
  );
}

function resolveHeaders(
  input: SecurityConfig["headers"],
  csp: CspConfig | undefined,
): Record<string, string> {
  const defaults = { ...DEFAULT_HEADERS };
  // `frame-ancestors` is the modern, finer-grained replacement; the default must not contradict it
  if (csp && "frame-ancestors" in csp.directives)
    delete (defaults as Record<string, string>)["X-Frame-Options"];
  return overlayHeaders(defaults, input);
}

function parseOrigin(origin: string, option: string): string {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error();
    return parsed.origin;
  } catch {
    throw new Error(
      `[noofpi] security.csrf.${option} must be absolute http(s) origins (got "${origin}")`,
    );
  }
}

function resolveCsrf(input: SecurityConfig["csrf"]): ResolvedSecurity["csrf"] {
  if (input === false) return false;
  const config = typeof input === "object" ? input : undefined;
  const resolved: { allowedOrigins: string[]; publicOrigin?: string } = {
    allowedOrigins: (config?.allowedOrigins ?? []).map((origin) =>
      parseOrigin(origin, "allowedOrigins"),
    ),
  };
  if (config?.publicOrigin !== undefined)
    resolved.publicOrigin = parseOrigin(config.publicOrigin, "publicOrigin");
  return resolved;
}

function resolveBodyLimit(
  input: SecurityConfig["bodyLimit"],
): ResolvedSecurity["bodyLimit"] {
  if (input === undefined) return DEFAULT_BODY_LIMIT;
  if (input === false) return false;
  if (!Number.isInteger(input) || input <= 0)
    throw new Error(
      `[noofpi] security.bodyLimit must be a positive number of bytes or false (got ${String(input)})`,
    );
  return input;
}

function resolveAllowedHosts(
  input: SecurityConfig["allowedHosts"],
): string[] | undefined {
  if (input === undefined) return undefined;
  return input.map((host) => {
    if (typeof host !== "string" || !/^(\*\.)?[^\s/*@]+$/.test(host))
      throw new Error(
        `[noofpi] security.allowedHosts must be hostnames like "app.example.com" or "*.example.com" (got "${String(host)}")`,
      );
    return host.toLowerCase();
  });
}

export function resolveSecurity(input: SecurityConfig = {}): ResolvedSecurity {
  if (input.csp) validateCsp(input.csp);
  return {
    csp: input.csp,
    headers: resolveHeaders(input.headers, input.csp),
    csrf: resolveCsrf(input.csrf),
    bodyLimit: resolveBodyLimit(input.bodyLimit),
    allowedHosts: resolveAllowedHosts(input.allowedHosts),
  };
}

/** What a `routeRules` entry may change: each option replaces (`csp`, `csrf`, `bodyLimit`) or is applied on top of (`headers`) the global one */
export interface RouteSecurityConfig {
  /** CSP of the matching pages instead of the global one. `false` sends none */
  csp?: CspConfig | false;
  /** Applied on top of the global headers (`false` value removes one, `false` alone removes them all) */
  headers?: boolean | Record<string, string | false>;
  /** CSRF protection of matching API / proxy paths instead of the global one. `false` turns it off */
  csrf?: boolean | CsrfConfig;
  /** Request body limit in bytes of matching paths instead of the global one. `false` turns it off */
  bodyLimit?: number | false;
}

/** The security of one request: the global one with the matching route rule's options applied. Throws on invalid options */
export function applyRouteSecurity(
  base: Partial<ResolvedSecurity> | undefined,
  rule: RouteSecurityConfig | undefined,
): Partial<ResolvedSecurity> | undefined {
  if (!rule) return base;
  if (rule.csp) validateCsp(rule.csp);
  const result: Partial<ResolvedSecurity> = { ...base };
  if (rule.csp !== undefined) result.csp = rule.csp || undefined;
  if (rule.headers !== undefined)
    result.headers = overlayHeaders(base?.headers ?? {}, rule.headers);
  if (rule.csrf !== undefined) result.csrf = resolveCsrf(rule.csrf);
  if (rule.bodyLimit !== undefined)
    result.bodyLimit = resolveBodyLimit(rule.bodyLimit);
  return result;
}

/** Whether the request's `Host` is one of the allowed hosts (`undefined`: any) */
export function isAllowedHost(
  url: URL,
  allowed: string[] | undefined,
): boolean {
  if (!allowed) return true;
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  return allowed.some((entry) =>
    entry.startsWith("*.")
      ? hostname.endsWith(entry.slice(1))
      : entry === host || entry === hostname,
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Applies a body limit to a request: a `Content-Length` over it, or a body stream that grows past it, makes
 * `tooLarge()` true (the stream then errors, so readers stop). Returns the request to use from then on.
 */
export function limitRequestBody(
  request: Request,
  limit: number,
): { request: Request; tooLarge: () => boolean } {
  if (SAFE_METHODS.has(request.method) || !request.body)
    return { request, tooLarge: () => false };
  if (Number(request.headers.get("content-length")) > limit)
    return { request, tooLarge: () => true };
  let received = 0;
  let exceeded = false;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) {
          exceeded = true;
          controller.error(new Error("[noofpi] Request body too large"));
        } else controller.enqueue(chunk);
      },
    }),
  );
  return {
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      signal: request.signal,
      duplex: "half",
    } as RequestInit),
    tooLarge: () => exceeded,
  };
}

/**
 * Whether a request is a state-changing request from another site. Browsers send `Origin` on cross-origin writes
 * (and `Sec-Fetch-Site` on every request); clients that send neither are not browsers, so CSRF does not apply.
 */
export function isCrossSiteWrite(
  request: Request,
  url: URL,
  csrf: { allowedOrigins: string[]; publicOrigin?: string },
): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (csrf.allowedOrigins.includes(origin)) return false;
    if (csrf.publicOrigin !== undefined) return origin !== csrf.publicOrigin;
    try {
      // Hosts are compared (not schemes) because a TLS-terminating proxy may hide https from this server
      return new URL(origin).host !== url.host;
    } catch {
      return true; // "null" origin (sandboxed frames, redirects across origins)
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}

/** Adds the headers the response does not already have. HSTS is only meaningful (and only sent) over https */
export function applySecurityHeaders(
  response: Response,
  headers: Record<string, string>,
  https: boolean,
): Response {
  const missing = Object.entries(headers).filter(
    ([name]) =>
      !response.headers.has(name) &&
      (https || name.toLowerCase() !== HSTS.toLowerCase()),
  );
  if (!missing.length) return response;
  const apply = (target: Headers) => {
    for (const [name, value] of missing) target.set(name, value);
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    // Headers of responses from `fetch()` are immutable
    const copy = new Headers(response.headers);
    apply(copy);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: copy,
    });
  }
}
