import {
  computed,
  inject,
  ref,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from "vue";
import {
  useRoute,
  type LocationQuery,
  type RouteLocationNormalized,
  type RouteParams,
  type Router,
} from "vue-router";
import type { AsyncDataError } from "../payload";
import { toError, type NoofpiPayloadState } from "./async-data";

export interface LoaderContext {
  route: RouteLocationNormalized;
  params: RouteParams;
  query: LocationQuery;
}

/** Runs before the page is shown (on the server for the first load, in the browser after that). `useDoofpi()` works at its start */
export type PageLoader<T> = (context: LoaderContext) => T | Promise<T>;

export interface PageDefinition<T> {
  loader: PageLoader<T>;
}

/**
 * Declares the loader of a page. Export the result as `page` from a plain `<script>` block (next to `<script setup>`)
 * and read the data with `useLoaderData(page)`, which is typed by the loader's return value:
 *
 * ```vue
 * <script lang="ts">
 * export const page = definePage({
 *   loader: ({ params }) => useDoofpi().users.get.read({ id: params.id }),
 * });
 * </script>
 * <script setup lang="ts">
 * const { data } = useLoaderData(page);
 * </script>
 * ```
 *
 * It has to be a module-level export, not part of `setup()`: the loader runs before the page is rendered.
 */
export function definePage<T>(page: PageDefinition<T>): PageDefinition<T> {
  return page;
}

/** Result of one loader run, kept for the route it belongs to */
export interface LoaderEntry {
  key: string;
  data?: unknown;
  error?: AsyncDataError;
}

export interface LoaderState {
  current: ShallowRef<LoaderEntry | undefined>;
  pending: Ref<boolean>;
  /** Runs the loader of the current route again */
  refresh(): Promise<void>;
}

export const LOADER_KEY: InjectionKey<LoaderState> = Symbol("noofpi:loader");

export interface Loaders {
  state: LoaderState;
  /** Browser only: loads the page behind `href` and runs its loader ahead of the navigation */
  prefetch(href: string): Promise<void>;
}

/** How long a prefetched result stays usable for the navigation that follows */
export const PREFETCH_TTL_MS = 30_000;

const loaderKey = (route: RouteLocationNormalized) =>
  "loader:" + route.fullPath.replace(/#.*$/, "");

function loaderOf(
  route: RouteLocationNormalized,
): PageLoader<unknown> | undefined {
  const loader = route.matched[route.matched.length - 1]?.meta.loader;
  return typeof loader === "function"
    ? (loader as PageLoader<unknown>)
    : undefined;
}

/**
 * Runs the loader of the page being navigated to, after the middleware and before the page renders.
 * The server embeds the result in the payload and the browser hydrates from it without running the loader again.
 * `run` calls the loader inside the app (so `useDoofpi()` works) with the target route as the current one.
 */
export function installLoaders(
  router: Router,
  options: {
    payload: NoofpiPayloadState;
    run: <T>(to: RouteLocationNormalized, call: () => T) => T;
  },
): Loaders {
  const { payload, run } = options;
  const state: LoaderState = {
    current: shallowRef(),
    pending: ref(false),
    async refresh() {
      const route = router.currentRoute.value;
      if (!loaderOf(route)) return;
      state.pending.value = true;
      try {
        state.current.value = await execute(route);
      } finally {
        state.pending.value = false;
      }
    },
  };
  const results = new Map<string, LoaderEntry>();
  const prefetched = new Map<
    string,
    { at: number; entry: Promise<LoaderEntry> }
  >();

  async function execute(to: RouteLocationNormalized): Promise<LoaderEntry> {
    const key = loaderKey(to);
    try {
      const loader = loaderOf(to)!;
      const data = await run(to, () =>
        loader({ route: to, params: to.params, query: to.query }),
      );
      return { key, data };
    } catch (error) {
      return { key, error: toError(error, payload.server) };
    }
  }

  router.beforeResolve(async (to) => {
    if (!loaderOf(to)) return;
    const key = loaderKey(to);
    // Only the hash changed: the data is still the right one
    if (state.current.value?.key === key) return;

    let entry: LoaderEntry;
    const cached = prefetched.get(key);
    prefetched.delete(key);
    if (!payload.server && key in payload.data) {
      entry = { key, data: payload.data[key] };
    } else if (!payload.server && key in payload.errors) {
      entry = { key, error: payload.errors[key] };
    } else if (cached && Date.now() - cached.at < PREFETCH_TTL_MS) {
      entry = await cached.entry;
    } else {
      entry = await execute(to);
    }
    if (payload.server) {
      if (entry.error) payload.errors[key] = entry.error;
      else payload.data[key] = entry.data === undefined ? null : entry.data;
    }
    results.set(key, entry);
  });

  // Applied once the navigation went through, so a cancelled one never shows the next page's data on the current page
  router.afterEach((to, _from, failure) => {
    if (failure) return;
    const key = loaderKey(to);
    const entry = results.get(key);
    results.delete(key);
    if (entry) state.current.value = entry;
    else if (state.current.value?.key !== key) state.current.value = undefined;
  });
  router.onError(() => results.clear());

  async function prefetch(href: string): Promise<void> {
    const to = router.resolve(href) as RouteLocationNormalized;
    const record = to.matched[to.matched.length - 1];
    if (!record) return;
    const key = loaderKey(to);
    const known = prefetched.get(key);
    if (known && Date.now() - known.at < PREFETCH_TTL_MS) return;
    if (key === loaderKey(router.currentRoute.value)) return;
    // The page module registers its loader on the route when it is imported
    const component = record.components?.default as unknown;
    if (typeof component === "function" && !("__vccOpts" in component))
      await (component as () => Promise<unknown>)();
    if (!loaderOf(to)) return;
    for (const [other, { at }] of prefetched)
      if (Date.now() - at >= PREFETCH_TTL_MS) prefetched.delete(other);
    const entry = execute(to);
    prefetched.set(key, { at: Date.now(), entry });
    await entry;
  }

  return { state, prefetch };
}

export interface LoaderData<T> {
  data: ComputedRef<T | undefined>;
  error: ComputedRef<AsyncDataError | undefined>;
  pending: Ref<boolean>;
  /** Runs the loader again */
  refresh: () => Promise<void>;
}

/**
 * The result of the page's loader: `page` is the `definePage()` export of the same file and gives `data` its type.
 * Call it inside `setup()`.
 */
export function useLoaderData<T>(page: PageDefinition<T>): LoaderData<T> {
  const state = inject(LOADER_KEY, null);
  if (!state)
    throw new Error("[noofpi] useLoaderData() must be called inside setup()");
  if (import.meta.env.DEV) {
    const route = useRoute();
    if (loaderOf(route) !== page.loader)
      console.warn(
        `[noofpi] useLoaderData() was called with a page whose loader does not belong to ${route.path}. ` +
          "Pass the `page` that this file exports from a plain <script> block.",
      );
  }
  return {
    data: computed(() => state.current.value?.data as T | undefined),
    error: computed(() => state.current.value?.error),
    pending: state.pending,
    refresh: state.refresh,
  };
}
