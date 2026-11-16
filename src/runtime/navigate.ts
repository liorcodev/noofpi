import { hasInjectionContext, inject } from "vue";
import {
  routerKey,
  type LocationQueryRaw,
  type NavigationFailure,
  type RouteLocationRaw,
  type Router,
} from "vue-router";
import type { Register } from "./doofpi-client";

/**
 * The page routes registered through {@link Register}: path pattern -> params. Filled in by the `.noofpi/routes.d.ts`
 * that noofpi generates from `app/pages`. Empty without it.
 */
export type RegisteredPages = Register extends {
  pages: infer P extends Record<string, unknown>;
}
  ? P
  : {};

export type RouteParamValue = string | number | string[];

export interface NavigateToOptions {
  /** Replace the current history entry instead of adding one */
  replace?: boolean;
  query?: LocationQueryRaw;
  hash?: string;
}

/** `{ params }` is required exactly when the page has params */
export type NavigateToArgs<P extends keyof RegisteredPages> =
  keyof RegisteredPages[P] extends never
    ? [options?: NavigateToOptions]
    : [options: NavigateToOptions & { params: RegisteredPages[P] }];

const PARAM = /\/:(\w+)(?:\([^)]*\))?([*+?])?/g;

/** `("/users/:id", { id: 5 })` -> `/users/5` ; `("/docs/:slug(.*)*", { slug: ["a", "b"] })` -> `/docs/a/b` */
export function fillRoutePath(
  pattern: string,
  params: Record<string, RouteParamValue>,
): string {
  const path = pattern.replace(PARAM, (_, name: string, modifier?: string) => {
    const value = params[name];
    const optional = modifier === "*" || modifier === "?";
    const parts = (Array.isArray(value) ? value : [value])
      .filter((part) => part !== undefined && part !== "")
      .map((part) => encodeURIComponent(String(part)));
    if (!parts.length) {
      if (optional) return "";
      throw new Error(
        `[noofpi] navigateTo("${pattern}") is missing the param "${name}"`,
      );
    }
    return "/" + parts.join("/");
  });
  return path || "/";
}

let browserRouter: Router | undefined;

/** Lets the browser call `navigateTo()` outside `setup()` (event handlers, timers). Not for the server: it is per request */
export function setBrowserRouter(router: Router | undefined): void {
  browserRouter = router;
}

function currentRouter(): Router {
  const router =
    (hasInjectionContext() ? inject(routerKey, null) : null) ?? browserRouter;
  if (!router)
    throw new Error(
      "[noofpi] navigateTo() must be called in the browser, inside setup() or inside app.runWithContext()",
    );
  return router;
}

/**
 * Client-side navigation to a page. With the generated `.noofpi/routes.d.ts`, the path is checked against `app/pages` and
 * its params are required and typed: `navigateTo("/users/:id", { params: { id: 5 } })`. Any other location
 * (`"/users/5"`, `{ name, query }`) works as in `router.push`. In route middleware, return the location instead.
 */
export function navigateTo<P extends keyof RegisteredPages & string>(
  to: P,
  ...args: NavigateToArgs<P>
): Promise<NavigationFailure | void | undefined>;
export function navigateTo<T extends RouteLocationRaw>(
  to: T extends keyof RegisteredPages ? never : T,
  options?: NavigateToOptions & { params?: Record<string, RouteParamValue> },
): Promise<NavigationFailure | void | undefined>;
export function navigateTo(
  to: RouteLocationRaw,
  options: NavigateToOptions & {
    params?: Record<string, RouteParamValue>;
  } = {},
): Promise<NavigationFailure | void | undefined> {
  const { params, replace, query, hash } = options;
  let location = to;
  if (typeof to === "string") {
    const path = params ? fillRoutePath(to, params) : to;
    location = query || hash ? { path, query, hash } : path;
  } else if (query || hash) {
    location = { ...to, ...(query && { query }), ...(hash && { hash }) };
  }
  const router = currentRouter();
  return replace ? router.replace(location) : router.push(location);
}
