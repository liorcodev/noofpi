import type { ClientFetch } from "doofpi";
import type { FetchMode } from "../fetch-mode";
import type { CookieJar } from "../cookies";
import type { ResolvedSecurity } from "../security";
import type { ResolvedHead, HeadConfig } from "../head";
import type { PayloadData } from "../payload";
import type { RouteRules } from "../route-rules";

export const PROXY_PREFIX = "/_noofpi/proxy";
export const SSR_OUTLET = "<!--ssr-outlet-->";

/** Server-side config (includes the remote `doofpi.url`, which is never sent to the browser for pfetch/sfetch) */
export interface ServerConfig {
  ssr: boolean;
  doofpi: {
    fetch: FetchMode;
    url: string | undefined;
    root: string;
  };
  head?: HeadConfig;
  routeRules?: RouteRules;
  security?: Partial<ResolvedSecurity>;
}

export interface RenderContext {
  origin: string;
  cookie?: string;
  /** The request's cookies; changes made while rendering are sent with the response */
  cookies: CookieJar;
  /** The request's `Accept-Language` header, for the `i18n` locale detection */
  acceptLanguage?: string;
  /** In-process fetch into the noofpi server (used for `lfetch` / `pfetch` during SSR) */
  fetch: ClientFetch;
}

export interface RenderResult {
  html: string;
  status: number;
  /** Set when a route middleware redirected: the handler answers with a 302 to this path instead of HTML */
  redirect?: string;
  /** An unexpected error that was rendered as `app/error.vue` (status 500); the handler reports it like any server error */
  error?: unknown;
  /** Data gathered by `useAsyncData` while rendering, embedded in the page for the browser */
  payload?: PayloadData;
  /** Title, meta tags and attributes gathered by `useHead` while rendering, written into the HTML shell */
  head?: ResolvedHead;
}

/**
 * Optional `server/proxy.ts` default export. Mutate `headers` to change what is sent to the doofpi API
 * (e.g. inject an `Authorization` token), or return a `Response` to short-circuit the request.
 */
export type ProxyHook = (ctx: {
  request: Request;
  headers: Headers;
  target: URL;
}) => void | Response | Promise<void | Response>;

export interface DoofpiLike {
  fetch(request: Request, env?: any, extra?: any): Promise<Response>;
}

export interface ServerMiddlewareContext {
  request: Request;
  url: URL;
  env?: unknown;
  /** Read the request's cookies and set / remove cookies on the response (also when you return your own `Response`) */
  cookies: CookieJar;
}

/**
 * A `server/middleware/*.ts` default export. Runs around every request the noofpi server handles (pages, the doofpi
 * API and the pfetch proxy). Call `next()` to continue and optionally change its response, or return your own
 * `Response` without calling it to short-circuit. Always returns a `Response`.
 */
export type ServerMiddleware = (
  ctx: ServerMiddlewareContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

/** Shape of the generated `virtual:noofpi/server` module */
export interface ServerModule {
  config: ServerConfig;
  doofpi?: DoofpiLike;
  proxyHook?: ProxyHook;
  /** `server/middleware/*` in file-name order, outermost first */
  middleware?: ServerMiddleware[];
  render?: (url: string, ctx: RenderContext) => Promise<RenderResult>;
}
