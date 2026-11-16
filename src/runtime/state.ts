import { hasInjectionContext, inject, ref, type Ref } from "vue";
import { PAYLOAD_KEY, type NoofpiPayloadState } from "./async-data";

/** Shared state by key, per request/app (the payload is created for each), so nothing leaks between requests */
const registries = new WeakMap<object, Map<string, Ref<unknown>>>();

function registryOf(payload: NoofpiPayloadState) {
  let registry = registries.get(payload);
  if (!registry) registries.set(payload, (registry = new Map()));
  return registry;
}

/** The browser has a single app, which lets `useState` work anywhere there (event handlers, `await` continuations) */
let browserPayload: NoofpiPayloadState | undefined;

export function setBrowserState(payload: NoofpiPayloadState | undefined) {
  browserPayload = payload;
}

/** The server renders many requests at once; the entry tells which one is running (via `AsyncLocalStorage`) */
let serverPayload: () => NoofpiPayloadState | undefined = () => undefined;

export function setServerStateSource(
  source: () => NoofpiPayloadState | undefined,
) {
  serverPayload = source;
}

const currentPayload = () =>
  (hasInjectionContext() ? inject(PAYLOAD_KEY, null) : null) ??
  serverPayload() ??
  browserPayload;

/** The values of all state created while rendering, for the payload (`undefined` is not JSON and is left out) */
export function collectState(
  payload: NoofpiPayloadState,
): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const [key, value] of registryOf(payload))
    if (value.value !== undefined) state[key] = value.value;
  return state;
}

/**
 * Reactive state shared by every caller that uses the same `key`. It is created per request on the server
 * (unlike a module-level `ref`, which would be shared between requests), embedded in the HTML and picked up by the
 * browser, so hydration starts from what the server rendered. `init` only runs when there is no value yet.
 * Values must be JSON-serializable.
 *
 * Works anywhere while a request is being rendered or in the browser: `setup()`, route middleware, composables and
 * utils, event handlers, also after an `await`.
 */
export function useState<T>(key: string): Ref<T | undefined>;
export function useState<T>(key: string, init: () => T): Ref<T>;
export function useState<T>(key: string, init?: () => T): Ref<T | undefined> {
  const payload = currentPayload();
  if (!payload)
    throw new Error(
      "[noofpi] useState() must be called while rendering a request or in the browser",
    );

  const registry = registryOf(payload);
  let state = registry.get(key) as Ref<T | undefined> | undefined;
  if (!state) {
    const hydrated = !payload.server && payload.state && key in payload.state;
    state = ref(hydrated ? payload.state![key] : undefined) as Ref<
      T | undefined
    >;
    registry.set(key, state);
  }
  if (state.value === undefined && init) state.value = init();
  return state;
}
