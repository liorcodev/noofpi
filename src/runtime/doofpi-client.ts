import { createClient, type ClientFetch } from "doofpi";
import type Doofpi from "doofpi";
import { inject, type InjectionKey } from "vue";
import { routeLocationKey } from "vue-router";
import { FETCH_MODES, type FetchMode } from "../fetch-mode";
import { recordFetch, type RequestLog } from "./inspector";
import {
  resolveFetchMode,
  usesFetchMode,
  type RouteRules,
} from "../route-rules";

export const PROXY_PREFIX = "/_noofpi/proxy";

/** doofpi's `Routes` type is not exported, but it is the constraint of `routes()` */
export type Routes = Parameters<Doofpi["routes"]>[0];

/**
 * Filled in by the `.noofpi/doofpi.d.ts` that noofpi generates from `server/doofpi.ts` (its `routes` export), so
 * clients are typed without a generic. Augment it yourself to register routes from elsewhere.
 */
export interface Register {}

/** The routes registered through {@link Register}, `any` when there are none */
export type RegisteredRoutes = Register extends {
  routes: infer R extends Routes;
}
  ? R
  : any;

export type DoofpiClient<R extends Routes = RegisteredRoutes> = ReturnType<
  typeof createClient<R>
>;

/** One client per fetch mode, picked by URL path (`routeRules[...].fetch`) or explicitly */
export interface DoofpiClients {
  forPath(pathname: string): DoofpiClient;
  /** The client of an explicit mode; it must be enabled by `doofpi.fetch` or a `routeRules[...].fetch` (`lfetch` always is) */
  forMode(mode: FetchMode): DoofpiClient;
  /** Path of the navigation in progress, so route middleware gets the client of the page it is going to */
  pending?: string;
}

export interface UseDoofpiOptions {
  /** Use this fetch mode instead of the one of the current page */
  mode?: FetchMode;
}

export const DOOFPI_KEY: InjectionKey<DoofpiClients> = Symbol("noofpi:doofpi");

/**
 * The doofpi client for the `doofpi.fetch` mode that applies to the current page (`routeRules[...].fetch` or the global
 * one), or for an explicit `{ mode }` (e.g. `useDoofpi({ mode: "sfetch" })`, which must be enabled in the config).
 * Call it inside `setup()` (or `app.runWithContext`); layouts and `app.vue` are set up once, so they keep the
 * client of the first page. Typed by the `routes` export of `server/doofpi.ts`; pass a routes type to override it:
 * `useDoofpi<OtherRoutes>()`.
 */
export function useDoofpi<R extends Routes = RegisteredRoutes>(
  options?: UseDoofpiOptions,
): DoofpiClient<R> {
  const clients = inject(DOOFPI_KEY, null);
  if (!clients)
    throw new Error(
      "[noofpi] useDoofpi() must be called inside setup() or app.runWithContext()",
    );
  if (options?.mode) return clients.forMode(options.mode) as DoofpiClient<R>;
  // Without a router (plain Vue apps, tests) there are no route rules to apply
  const path = clients.pending ?? inject(routeLocationKey, null)?.path ?? "/";
  return clients.forPath(path) as DoofpiClient<R>;
}

export interface DoofpiClientConfig {
  fetch: FetchMode;
  url: string | undefined;
  root: string;
}

export interface DoofpiClientContext {
  /** `true` while rendering on the server */
  server: boolean;
  /** Origin of the noofpi server */
  origin: string;
  cookie?: string;
  /** In-process fetch into the noofpi server (server only) */
  fetch?: ClientFetch;
  /** Dev request inspector: every request of the clients is recorded here */
  log?: RequestLog;
}

const browserBlocked: ClientFetch = () =>
  Promise.reject(
    new Error(
      '[noofpi] doofpi.fetch is "sfetch": doofpi requests are only allowed on the server',
    ),
  );

export function createDoofpiClients(
  config: DoofpiClientConfig,
  rules: RouteRules | undefined,
  ctx: DoofpiClientContext,
): DoofpiClients {
  const clients = new Map<FetchMode, DoofpiClient>();
  const forMode = (mode: FetchMode) => {
    let client = clients.get(mode);
    if (!client) {
      client = createDoofpiClient({ ...config, fetch: mode }, ctx);
      clients.set(mode, client);
    }
    return client;
  };
  return {
    forPath: (pathname) =>
      forMode(resolveFetchMode(config.fetch, rules, pathname)),
    forMode(mode) {
      if (!FETCH_MODES.includes(mode))
        throw new Error(
          `[noofpi] useDoofpi({ mode }) must be one of ${FETCH_MODES.join(", ")} (got "${String(mode)}")`,
        );
      // The proxy, the browser's `doofpi.url` and the url check are decided by the config, so a mode must be enabled there
      if (mode !== "lfetch" && !usesFetchMode(config.fetch, rules, mode))
        throw new Error(
          `[noofpi] useDoofpi({ mode: "${mode}" }) needs "${mode}" in the config: set doofpi.fetch or a routeRules[...].fetch to "${mode}"`,
        );
      return forMode(mode);
    },
  };
}

export function createDoofpiClient(
  config: DoofpiClientConfig,
  ctx: DoofpiClientContext,
): DoofpiClient {
  const { server, origin } = ctx;
  const cookie =
    server && ctx.cookie ? { headers: { cookie: ctx.cookie } } : undefined;

  // Only with the dev request inspector: the client's `fetch` (the global one by default) records its requests
  const track = (fetch: ClientFetch | undefined): ClientFetch | undefined =>
    ctx.log
      ? recordFetch(
          fetch ?? ((input, init) => globalThis.fetch(input, init)),
          ctx.log,
          {
            side: server ? "server" : "browser",
            mode: config.fetch,
            transport: fetch && fetch === ctx.fetch ? "in-process" : "http",
          },
        )
      : fetch;

  switch (config.fetch) {
    case "dfetch":
      return createClient<any>({
        url: config.url!,
        root: config.root,
        fetch: track(undefined),
      });
    case "sfetch":
      return createClient<any>({
        url: config.url ?? origin,
        root: config.root,
        fetch: track(server ? undefined : browserBlocked),
      });
    case "pfetch":
      return createClient<any>({
        url: origin,
        root: PROXY_PREFIX + config.root,
        init: cookie,
        // On the server the proxy is called in-process, so the same proxy hook applies as in the browser
        fetch: track(server ? ctx.fetch : undefined),
      });
    case "lfetch":
      return createClient<any>({
        url: origin,
        root: config.root,
        init: cookie,
        fetch: track(server ? ctx.fetch : undefined),
      });
  }
}
