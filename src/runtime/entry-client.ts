import { publicConfig } from "virtual:noofpi/config";
import routeMiddleware from "virtual:noofpi/middleware";
import { createNoofpiApp } from "./app";
import { listenForPrefetch } from "./prefetch";

export async function mount(): Promise<void> {
  const { app, router, payload, error, log, loaders, i18n } = createNoofpiApp({
    server: false,
  });
  // Asked for right away: a failed first navigation settles before the awaits below, and vue-router never settles a later `isReady()`
  const navigated = router.isReady().then(
    () => undefined,
    (failure: unknown) => ({ failure }),
  );
  // Before mounting, so the first render (and hydration) already has the messages of the locale the server used
  await i18n?.ready;
  // `import.meta.env.DEV` keeps the overlay (and its code) out of production builds
  if (import.meta.env.DEV && publicConfig.devtools) {
    const { mountDevtools } = await import("./devtools");
    mountDevtools({
      router,
      config: publicConfig,
      middlewareFiles: Object.keys(routeMiddleware),
      requests: log,
      app,
      payload: {
        data: payload.data,
        errors: payload.errors,
        state: payload.state,
        locale: payload.locale,
        error: payload.error,
      },
    });
  }
  // A `createError()` thrown by a route middleware during the first navigation is shown as the error page
  const outcome = await navigated;
  if (outcome && !error.value) throw outcome.failure;
  app.mount("#app");
  listenForPrefetch(loaders.prefetch);
  // The payload only serves the first render; later navigations must fetch fresh data
  payload.data = {};
  payload.errors = {};
}
