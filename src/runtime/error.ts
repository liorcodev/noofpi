import {
  defineComponent,
  h,
  hasInjectionContext,
  inject,
  type App,
  type Component,
  type InjectionKey,
  type Ref,
} from "vue";
import { START_LOCATION, type Router } from "vue-router";
import {
  createError,
  isNoofpiError,
  toErrorData,
  type CreateErrorInput,
  type NoofpiError,
  type NoofpiErrorData,
} from "../error";

export type ErrorState = Ref<NoofpiErrorData | null>;

export const ERROR_KEY: InjectionKey<ErrorState> = Symbol("noofpi:error");

/** The browser has a single app, which lets `showError()` / `clearError()` work outside `setup()` (event handlers) */
let browser: { error: ErrorState; router: Router } | undefined;

const currentState = (): ErrorState | undefined =>
  (hasInjectionContext() ? inject(ERROR_KEY, undefined) : undefined) ??
  browser?.error;

export const notFoundError = (url: string): NoofpiErrorData =>
  toErrorData(
    createError({
      statusCode: 404,
      statusMessage: "Page Not Found",
      message: `Page not found: ${url}`,
    }),
    url,
  );

/** The error being shown by `app/error.vue`, or `null` while the page renders normally */
export function useError(): ErrorState {
  const state = currentState();
  if (!state)
    throw new Error("[noofpi] useError() must be called inside setup()");
  return state;
}

/** Shows `app/error.vue` with this error instead of the page (in the browser, until `clearError()` or a navigation) */
export function showError(
  error: string | CreateErrorInput | NoofpiError,
): NoofpiError {
  const state = currentState();
  if (!state)
    throw new Error("[noofpi] showError() must be called inside setup()");
  const created = isNoofpiError(error) ? error : createError(error);
  state.value = toErrorData(created);
  return created;
}

/** Hides the error page. Pass `redirect` to navigate away, which is needed after a "page not found" error */
export async function clearError(
  options: { redirect?: string } = {},
): Promise<void> {
  const state = currentState();
  if (!state)
    throw new Error("[noofpi] clearError() must be called inside setup()");
  state.value = null;
  if (options.redirect !== undefined) {
    if (!browser)
      throw new Error("[noofpi] clearError() can only redirect in the browser");
    await browser.router.push(options.redirect);
  }
}

/** Renders `app/error.vue` instead of the app while an error is active */
export function createRootComponent(
  Root: Component,
  ErrorPage: Component,
): Component {
  return defineComponent({
    name: "NoofpiRoot",
    setup() {
      const error = useError();
      return () =>
        error.value ? h(ErrorPage, { error: error.value }) : h(Root);
    },
  });
}

/**
 * Browser side of the error page: unmatched URLs and `createError()` errors thrown by pages or middleware show it,
 * and the next successful navigation hides it again.
 */
export function bindBrowserErrorPage(
  app: App,
  router: Router,
  error: ErrorState,
): void {
  browser = { error, router };
  const urlOf = () => location.pathname + location.search;
  router.afterEach((to, from) => {
    if (!to.matched.length) error.value = notFoundError(to.fullPath);
    // The first navigation hydrates what the server rendered, including an error it chose to show
    else if (from !== START_LOCATION) error.value = null;
  });
  router.onError((failure) => {
    if (isNoofpiError(failure)) error.value = toErrorData(failure, urlOf());
  });
  app.config.errorHandler = (failure) => {
    if (isNoofpiError(failure)) error.value = toErrorData(failure, urlOf());
    else console.error(failure);
  };
}
