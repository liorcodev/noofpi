import {
  useAsyncData,
  type AsyncData,
  type UseAsyncDataOptions,
} from "./async-data";
import {
  useDoofpi,
  type DoofpiClient,
  type Routes,
  type RoutesForMode,
} from "./doofpi-client";
import type { FetchMode } from "../fetch-mode";

/**
 * `useAsyncData` with the doofpi client handed to the handler: fetched on the server, transferred to the browser,
 * not fetched again while hydrating. The client is typed by the `Register` routes of its mode (`localRoutes` for
 * `lfetch`, `remoteRoutes` for the others): `useDoofpiFetch("hello", (client) => client.hello.read())`.
 * `key` must be unique per piece of data. `options.mode` picks the fetch mode like `useDoofpi({ mode })`.
 * To type the client with other routes, annotate it: `(client: DoofpiClient<OtherRoutes>) => ...`.
 * Call inside `setup()`.
 */
export function useDoofpiFetch<T, M extends FetchMode | undefined = undefined>(
  key: string,
  handler: (client: DoofpiClient<RoutesForMode<M>>) => Promise<T>,
  options?: UseAsyncDataOptions & { mode?: M },
): AsyncData<T>;
export function useDoofpiFetch<T, R extends Routes>(
  key: string,
  handler: (client: DoofpiClient<R>) => Promise<T>,
  options?: UseAsyncDataOptions & { mode?: FetchMode },
): AsyncData<T>;
export function useDoofpiFetch<T>(
  key: string,
  handler: (client: DoofpiClient<any>) => Promise<T>,
  options?: UseAsyncDataOptions & { mode?: FetchMode },
): AsyncData<T> {
  const { mode, ...asyncOptions } = options ?? {};
  const client = useDoofpi({ mode });
  return useAsyncData(key, () => handler(client), asyncOptions);
}
