import { createApp, createSSRApp, ref, watch, type App } from "vue";
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type Router,
} from "vue-router";
import { publicConfig, serverConfig } from "virtual:noofpi/config";
import routes from "virtual:noofpi/routes";
import routeMiddleware from "virtual:noofpi/middleware";
import appPlugins from "virtual:noofpi/plugins";
import AppRoot from "virtual:noofpi/app-root";
import ErrorPage from "virtual:noofpi/error";
import { i18nConfig, messageFiles, messageLoaders } from "virtual:noofpi/i18n";
import { readPayload } from "../payload";
import {
  LOCALE_COOKIE,
  matchLocale,
  parseAcceptLanguage,
  pickLocale,
  textDirection,
} from "../i18n";
import { isServerRendered } from "../route-rules";
import { PAYLOAD_KEY, type NoofpiPayloadState } from "./async-data";
import { installLoaders, LOADER_KEY, type Loaders } from "./loader";
import {
  createDoofpiClients,
  DOOFPI_KEY,
  type DoofpiClientContext,
} from "./doofpi-client";
import {
  applyHeadToDocument,
  createHeadManager,
  HEAD_KEY,
  type HeadManager,
} from "./head";
import { createMiddlewareGuard, createMiddlewareRegistry } from "./middleware";
import { setBrowserRouter } from "./navigate";
import { runPlugins } from "./plugins";
import { setBrowserState } from "./state";
import { addEntries, createRequestLog, type RequestLog } from "./inspector";
import { createCookieJar, type CookieJar } from "../cookies";
import type { NoofpiErrorData } from "../error";
import { COOKIES_KEY, createBrowserCookieJar } from "./cookie";
import { catalogFromFiles, createI18n, I18N_KEY, type I18n } from "./i18n";
import {
  bindBrowserErrorPage,
  createRootComponent,
  ERROR_KEY,
  type ErrorState,
} from "./error";

export interface NoofpiAppContext extends Omit<DoofpiClientContext, "origin"> {
  origin?: string;
  /** The request's `Accept-Language` header (server only), used to pick the `i18n` locale */
  acceptLanguage?: string;
  /** The server's jar for the request; without it the server builds one from `cookie` and the browser uses `document.cookie` */
  cookies?: CookieJar;
}

export function createNoofpiApp(ctx: NoofpiAppContext): {
  app: App;
  router: Router;
  payload: NoofpiPayloadState;
  head: HeadManager;
  /** The error `app/error.vue` shows instead of the app; `null` for a normal render */
  error: ErrorState;
  /** Dev request inspector: the doofpi requests of this app (`undefined` in production or with `devtools: false`) */
  log: RequestLog | undefined;
  /** `undefined` unless `i18n` is configured */
  i18n: I18n | undefined;
  loaders: Loaders;
} {
  const config = ctx.server ? serverConfig! : publicConfig;
  // The browser hydrates server markup only for pages the server rendered (`ssr` and `routeRules`)
  const hydrate =
    ctx.server ||
    isServerRendered(config.ssr, config.routeRules, location.pathname);
  const app = (hydrate ? createSSRApp : createApp)(
    ErrorPage ? createRootComponent(AppRoot, ErrorPage) : AppRoot,
  );
  const router = createRouter({
    history: ctx.server
      ? createMemoryHistory()
      : createWebHistory(import.meta.env.BASE_URL),
    routes,
  });
  const log =
    import.meta.env.DEV && publicConfig.devtools
      ? createRequestLog()
      : undefined;
  const clients = createDoofpiClients(config.doofpi, config.routeRules, {
    ...ctx,
    origin: ctx.origin ?? window.location.origin,
    log,
  });
  router.beforeEach((to) => {
    clients.pending = to.path;
  });
  router.beforeEach(
    createMiddlewareGuard(createMiddlewareRegistry(routeMiddleware)),
  );
  const settle = () => {
    clients.pending = undefined;
  };
  router.afterEach(settle);
  router.onError(settle);
  app.use(router);
  if (!ctx.server) setBrowserRouter(router);
  const cookies =
    ctx.cookies ??
    (ctx.server
      ? createCookieJar({ cookie: ctx.cookie })
      : createBrowserCookieJar());
  app.provide(COOKIES_KEY, cookies);
  app.provide(DOOFPI_KEY, clients);
  const payload: NoofpiPayloadState = ctx.server
    ? { server: true, data: {}, errors: {} }
    : {
        server: false,
        ...(hydrate ? readPayload() : { data: {}, errors: {} }),
      };
  app.provide(PAYLOAD_KEY, payload);
  // After the middleware guard (`beforeEach`): a page's loader only runs for a navigation that was not redirected or aborted
  const loaders = installLoaders(router, {
    payload,
    run: (to, call) => {
      // `useDoofpi()` in the loader gets the client of the page it loads, also for a prefetch (no navigation in progress)
      const previous = clients.pending;
      clients.pending = to.path;
      try {
        return app.runWithContext(call);
      } finally {
        clients.pending = previous;
      }
    },
  });
  app.provide(LOADER_KEY, loaders.state);
  if (!ctx.server) setBrowserState(payload);
  if (log && payload.requests) addEntries(log, payload.requests);
  const error: ErrorState = ref<NoofpiErrorData | null>(payload.error ?? null);
  app.provide(ERROR_KEY, error);
  if (ErrorPage && !ctx.server) bindBrowserErrorPage(app, router, error);

  let i18n: I18n | undefined;
  if (i18nConfig) {
    // What the server rendered in wins in the browser, so hydration matches whatever the server detected
    const rendered =
      !ctx.server && hydrate
        ? matchLocale([payload.locale], i18nConfig.locales)
        : undefined;
    i18n = createI18n({
      config: i18nConfig,
      catalog: catalogFromFiles(messageFiles, i18nConfig.locales),
      loaders: catalogFromFiles(messageLoaders, i18nConfig.locales),
      locale:
        rendered ??
        pickLocale(i18nConfig, {
          saved: cookies.get(LOCALE_COOKIE),
          preferred: ctx.server
            ? parseAcceptLanguage(ctx.acceptLanguage)
            : navigator.languages,
        }),
      cookies,
    });
    app.provide(I18N_KEY, i18n);
    app.config.globalProperties.$t = i18n.t;
  }

  const head = createHeadManager(config.head);
  app.provide(HEAD_KEY, head);
  // First, so a page's own `useHead({ htmlAttrs })` can override it
  if (i18n) {
    const { locale } = i18n;
    head.add(() => ({
      htmlAttrs: { lang: locale.value, dir: textDirection(locale.value) },
    }));
  }
  // The server writes the head into the HTML; the browser keeps the document in sync after that
  if (!ctx.server)
    watch(() => head.resolve(), applyHeadToDocument, { flush: "post" });
  runPlugins(appPlugins, { app, router, server: !!ctx.server });
  return { app, router, payload, head, error, log, i18n, loaders };
}
