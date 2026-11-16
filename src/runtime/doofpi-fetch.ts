import {
  useAsyncData,
  type AsyncData,
  type UseAsyncDataOptions,
} from "./async-data";
import {
  useDoofpi,
  type DoofpiClient,
  type RegisteredRoutes,
  type Routes,
} from "./doofpi-client";
import type { FetchMode } from "../fetch-mode";

/**
 * `useAsyncData` with the doofpi client handed to the handler: fetched on the server, transferred to the browser,
 * not fetched again while hydrating. The client is typed by the `routes` export of `server/doofpi.ts`:
 * `useDoofpiFetch("hello", (client) => client.hello.read())`.
 * `key` must be unique per piece of data. `options.mode` picks the fetch mode like `useDoofpi({ mode })`.
 * Call inside `setup()`.
 */
export function useDoofpiFetch<T, R extends Routes = RegisteredRoutes>(
  key: string,
  handler: (client: DoofpiClient<R>) => Promise<T>,
  options?: UseAsyncDataOptions & { mode?: FetchMode },
): AsyncData<T> {
  const { mode, ...asyncOptions } = options ?? {};
  const client = useDoofpi<R>({ mode });
  return useAsyncData(key, () => handler(client), asyncOptions);
}
