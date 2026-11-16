import {
  inject,
  onServerPrefetch,
  ref,
  type InjectionKey,
  type Ref,
} from "vue";
import { isNoofpiError } from "../error";
import type { AsyncDataError, PayloadData } from "../payload";

export interface NoofpiPayloadState extends PayloadData {
  server: boolean;
}

export const PAYLOAD_KEY: InjectionKey<NoofpiPayloadState> =
  Symbol("noofpi:payload");

export interface UseAsyncDataOptions {
  /** Fetch during SSR and transfer the result to the browser (default: `true`). `false` fetches in the browser only. */
  server?: boolean;
}

export interface AsyncData<T> {
  data: Ref<T | undefined>;
  error: Ref<AsyncDataError | undefined>;
  pending: Ref<boolean>;
  /** Fetch again (always runs the handler) */
  refresh: () => Promise<void>;
}

/** On the server only `createError()` messages are kept: any other error is an unexpected failure that must not reach the HTML */
export function toError(error: unknown, server = false): AsyncDataError {
  const { message, status } = (error ?? {}) as {
    message?: unknown;
    status?: unknown;
  };
  return {
    message:
      server && !isNoofpiError(error)
        ? "Internal Server Error"
        : typeof message === "string"
          ? message
          : String(error),
    ...(typeof status === "number" ? { status } : {}),
  };
}

/**
 * Fetches data once and shares it between server and browser: on the server the handler runs while rendering and
 * the result is embedded in the HTML; the browser hydrates from it without calling the handler again.
 * Client-side navigation runs the handler in the browser. `key` must be unique per piece of data.
 * Results must be JSON-serializable. Call inside `setup()`.
 */
export function useAsyncData<T>(
  key: string,
  handler: () => Promise<T>,
  options: UseAsyncDataOptions = {},
): AsyncData<T> {
  const payload = inject(PAYLOAD_KEY, null);
  if (!payload)
    throw new Error("[noofpi] useAsyncData() must be called inside setup()");

  const hydrated =
    !payload.server && (key in payload.data || key in payload.errors);
  const data = ref(hydrated ? payload.data[key] : undefined) as Ref<
    T | undefined
  >;
  const error = ref(hydrated ? payload.errors[key] : undefined) as Ref<
    AsyncDataError | undefined
  >;
  const pending = ref(!hydrated);

  const refresh = async () => {
    pending.value = true;
    error.value = undefined;
    try {
      data.value = await handler();
    } catch (e) {
      error.value = toError(e, payload.server);
    } finally {
      pending.value = false;
    }
  };

  if (payload.server) {
    if (options.server !== false) {
      onServerPrefetch(async () => {
        await refresh();
        if (error.value) payload.errors[key] = error.value;
        else payload.data[key] = data.value === undefined ? null : data.value;
      });
    }
  } else if (!hydrated) {
    void refresh();
  }

  return { data, error, pending, refresh };
}
