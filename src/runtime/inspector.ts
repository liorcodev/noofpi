import { reactive } from "vue";
import type { ClientFetch } from "doofpi";
import type { RequestEntry } from "../requests";

export interface RequestLog {
  list: RequestEntry[];
}

const MAX_REQUESTS = 100;

export const createRequestLog = (): RequestLog =>
  reactive<RequestLog>({ list: [] });

/** Adds entries (e.g. the ones the server transferred), keeping only the newest ones */
export function addEntries(log: RequestLog, entries: RequestEntry[]): void {
  log.list = [...log.list, ...entries].slice(-MAX_REQUESTS);
}

/** Plain copies of the entries, for the payload */
export const snapshotEntries = (log: RequestLog): RequestEntry[] =>
  log.list.map((entry) => ({ ...entry }));

/** Wraps a doofpi client `fetch` so every call is recorded in the log */
export function recordFetch(
  base: ClientFetch,
  log: RequestLog,
  info: Pick<RequestEntry, "side" | "mode" | "transport">,
): ClientFetch {
  return async (input, init) => {
    addEntries(log, [
      {
        ...info,
        method: (init?.method ?? "GET").toUpperCase(),
        url: input,
      },
    ]);
    // Read back through the reactive list, so the changes below update the overlay
    const entry = log.list.at(-1)!;
    const start = performance.now();
    try {
      const response = await base(input, init);
      entry.status = response.status;
      return response;
    } catch (failure) {
      entry.error =
        failure instanceof Error ? failure.message : String(failure);
      throw failure;
    } finally {
      entry.ms = Math.round(performance.now() - start);
    }
  };
}
