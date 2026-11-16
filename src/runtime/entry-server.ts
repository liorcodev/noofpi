import { AsyncLocalStorage } from "node:async_hooks";
import { renderToString } from "vue/server-renderer";
import ErrorPage from "virtual:noofpi/error";
import { createNoofpiApp } from "./app";
import { notFoundError } from "./error";
import { snapshotEntries } from "./inspector";
import { collectState, setServerStateSource } from "./state";
import { isNoofpiError, toErrorData } from "../error";
import type { RenderContext, RenderResult } from "../server/types";
import type { NoofpiPayloadState } from "./async-data";

/** Which request's state `useState` reaches from code that is not inside the app (plain functions, after an `await`) */
const requestScope = new AsyncLocalStorage<{ payload?: NoofpiPayloadState }>();
setServerStateSource(() => requestScope.getStore()?.payload);

async function renderRoute(
  url: string,
  ctx: RenderContext,
): Promise<RenderResult> {
  const { app, router, payload, head, error, log, i18n } = createNoofpiApp({
    server: true,
    ...ctx,
  });
  requestScope.getStore()!.payload = payload;
  const failure = await router.push(url);
  await router.isReady();
  // A middleware returned `false`: nothing to render
  if (failure) {
    if (!ErrorPage) return { html: "", status: 404 };
    error.value = notFoundError(url);
  } else {
    // A middleware redirect navigates to the new location; the browser has to follow it with a real redirect
    const requested = router.resolve(url).fullPath;
    const current = router.currentRoute.value.fullPath;
    if (current !== requested) {
      return {
        html: "",
        status: 302,
        // One leading slash only, so a redirect can never turn into a protocol-relative (external) URL
        redirect: "/" + current.replace(/^\/+/, ""),
      };
    }
    if (ErrorPage && !router.currentRoute.value.matched.length)
      error.value = notFoundError(url);
  }
  // Vue reports errors thrown while rendering to the app's handler (and carries on), so they are collected here
  const failures: unknown[] = [];
  if (ErrorPage)
    app.config.errorHandler = (failure) => void failures.push(failure);
  const html = await renderToString(app);
  if (failures.length) throw failures[0];
  return {
    html,
    status: error.value
      ? error.value.statusCode
      : router.currentRoute.value.matched.length
        ? 200
        : 404,
    payload: {
      data: payload.data,
      errors: payload.errors,
      state: collectState(payload),
      ...(error.value ? { error: error.value } : {}),
      ...(i18n ? { locale: i18n.locale.value } : {}),
      ...(log ? { requests: snapshotEntries(log) } : {}),
    },
    // Resolved after rendering, so titles that depend on fetched data are included
    head: head.resolve(),
  };
}

/** Renders `app/error.vue` for an error thrown while rendering, in a fresh app (the failed one may be half-built) */
async function renderErrorPage(
  url: string,
  ctx: RenderContext,
  failure: unknown,
): Promise<RenderResult> {
  const { app, payload, head, error, log, i18n } = createNoofpiApp({
    server: true,
    ...ctx,
  });
  // The failed app may have left half-built state behind; this is a fresh app with its own
  requestScope.getStore()!.payload = payload;
  error.value = toErrorData(failure, url);
  const failures: unknown[] = [];
  app.config.errorHandler = (inner) => void failures.push(inner);
  const html = await renderToString(app);
  // A broken error page falls back to the plain 500 response
  if (failures.length) throw failures[0];
  return {
    html,
    status: error.value.statusCode,
    // Errors made with `createError()` are intended; anything else is a bug the server has to report
    ...(isNoofpiError(failure) ? {} : { error: failure }),
    payload: {
      data: {},
      errors: {},
      state: collectState(payload),
      error: error.value,
      ...(i18n ? { locale: i18n.locale.value } : {}),
      ...(log ? { requests: snapshotEntries(log) } : {}),
    },
    head: head.resolve(),
  };
}

export function render(url: string, ctx: RenderContext): Promise<RenderResult> {
  return requestScope.run({}, async () => {
    try {
      return await renderRoute(url, ctx);
    } catch (failure) {
      if (!ErrorPage) throw failure;
      return await renderErrorPage(url, ctx, failure);
    }
  });
}
