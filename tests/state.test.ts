import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { injectPayload } from "../src/payload";
import {
  PAYLOAD_KEY,
  type NoofpiPayloadState,
} from "../src/runtime/async-data";
import {
  collectState,
  setBrowserState,
  setServerStateSource,
  useState,
} from "../src/runtime/state";

const state = (
  server: boolean,
  init: Partial<NoofpiPayloadState> = {},
): NoofpiPayloadState => ({ server, data: {}, errors: {}, ...init });

const render = (payload: NoofpiPayloadState, init: () => number) => {
  const Child = defineComponent({
    setup() {
      const count = useState("count", init);
      return () => h("i", String(count.value));
    },
  });
  const Comp = defineComponent({
    setup() {
      const count = useState("count", init);
      count.value++;
      return () => h("div", [h("p", String(count.value)), h(Child)]);
    },
  });
  const app = createSSRApp(Comp);
  app.provide(PAYLOAD_KEY, payload);
  return renderToString(app);
};

afterEach(() => {
  setBrowserState(undefined);
  setServerStateSource(() => undefined);
});

describe("useState in components", () => {
  it("is shared by key and collected for the payload", async () => {
    const payload = state(true);
    const html = await render(payload, () => 1);
    expect(html).toContain("<p>2</p><i>2</i>");
    expect(collectState(payload)).toEqual({ count: 2 });
  });

  it("does not leak between requests", async () => {
    await render(state(true), () => 1);
    const second = state(true);
    await render(second, () => 10);
    expect(collectState(second)).toEqual({ count: 11 });
  });

  it("starts from the payload in the browser without calling init", async () => {
    const init = vi.fn(() => 0);
    const html = await render(state(false, { state: { count: 5 } }), init);
    expect(html).toContain("<p>6</p>");
    expect(init).not.toHaveBeenCalled();
  });

  it("leaves out undefined values", () => {
    const payload = state(true);
    createSSRApp({})
      .provide(PAYLOAD_KEY, payload)
      .runWithContext(() => {
        useState("empty");
      });
    expect(collectState(payload)).toEqual({});
  });
});

describe("useState outside setup()", () => {
  it("works in app.runWithContext (route middleware)", () => {
    const payload = state(true);
    const app = createSSRApp({}).provide(PAYLOAD_KEY, payload);
    app.runWithContext(() => {
      useState("user", () => "ada");
    });
    expect(collectState(payload)).toEqual({ user: "ada" });
  });

  it("works anywhere in the browser, sharing the app's state", () => {
    const payload = state(false, { state: { count: 1 } });
    setBrowserState(payload);
    // No injection context: an event handler or a function after an `await`
    useState("count", () => 0).value++;
    const html = renderToString(
      createSSRApp({
        render: () => h("p", String(useState("count").value)),
      }).provide(PAYLOAD_KEY, payload),
    );
    return expect(html).resolves.toContain("<p>2</p>");
  });

  it("works on the server through the request scope, one state per request", () => {
    const a = state(true);
    const b = state(true);
    let current = a;
    setServerStateSource(() => current);
    useState("n", () => 1);
    current = b;
    useState("n", () => 2);
    expect(collectState(a)).toEqual({ n: 1 });
    expect(collectState(b)).toEqual({ n: 2 });
  });

  it("explains itself when there is no app or request", () => {
    expect(() => useState("x")).toThrow(/while rendering a request/);
  });
});

describe("payload", () => {
  it("carries the state", () => {
    expect(
      injectPayload("<body></body>", {
        data: {},
        errors: {},
        state: { count: 1 },
      }),
    ).toContain('"state":{"count":1}');
  });
});
