import {
  useRoute,
  type NavigationGuard,
  type NavigationGuardReturn,
  type RouteLocationNormalized,
} from "vue-router";

/**
 * Runs before a navigation, on the server and in the browser. Return nothing (or `true`) to continue,
 * `false` to abort, or a route location (`"/login"`) to redirect. Composables such as `useDoofpi()` work inside it.
 */
export type RouteMiddleware = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
) => NavigationGuardReturn | Promise<NavigationGuardReturn>;

export interface MiddlewareRegistry {
  global: RouteMiddleware[];
  named: Record<string, RouteMiddleware>;
}

export function defineRouteMiddleware(
  middleware: RouteMiddleware,
): RouteMiddleware {
  return middleware;
}

const GLOBAL_SUFFIX = /\.global$/;

/** `/app/middleware/AuthAdmin.ts` -> `auth-admin` ; `/app/middleware/log.global.ts` -> `log` (global) */
export function parseMiddlewareFile(file: string): {
  name: string;
  global: boolean;
} {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.[jt]s$/, "");
  return {
    name: base
      .replace(GLOBAL_SUFFIX, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase(),
    global: GLOBAL_SUFFIX.test(base),
  };
}

/** Global middleware runs in file-name order; named middleware is picked per page with `useMiddleware()` */
export function createMiddlewareRegistry(
  modules: Record<string, RouteMiddleware>,
): MiddlewareRegistry {
  const registry: MiddlewareRegistry = { global: [], named: {} };
  for (const [file, middleware] of Object.entries(modules).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const { name, global } = parseMiddlewareFile(file);
    if (global) registry.global.push(middleware);
    else registry.named[name] = middleware;
  }
  return registry;
}

/** `meta.middleware` as a list of names */
export function normalizeMiddleware(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === "string")
    : [];
}

/** Router guard: global middleware first, then the page's named middleware; the first redirect or abort wins */
export function createMiddlewareGuard(
  registry: MiddlewareRegistry,
): NavigationGuard {
  return async (to, from) => {
    const chain = [...registry.global];
    for (const name of normalizeMiddleware(to.meta.middleware)) {
      const middleware = registry.named[name];
      // Failing closed: a guard that silently does not run is worse than an error
      if (!middleware)
        throw new Error(
          `[noofpi] Unknown middleware "${name}" used by ${to.path}. Add app/middleware/${name}.ts.`,
        );
      chain.push(middleware);
    }
    for (const middleware of chain) {
      const result = await middleware(to, from);
      if (result !== undefined && result !== true) return result;
    }
  };
}

/**
 * Runs the named middleware (from `app/middleware/`) before the page is shown, after the global ones.
 * Call it in a page's `setup()` with string literals. noofpi reads them at build time (the middleware must run before
 * the page renders, also on the server), so variables and expressions are not supported.
 */
export function useMiddleware(names: string | string[]): void {
  if (import.meta.env.DEV) {
    const route = useRoute();
    const wanted = normalizeMiddleware(names);
    const picked = normalizeMiddleware(route.meta.middleware);
    if (wanted.join() !== picked.join()) {
      console.warn(
        `[noofpi] useMiddleware(${JSON.stringify(names)}) was not picked up for ${route.path}. ` +
          "Call it with string literals inside a page in app/pages.",
      );
    }
  }
}
