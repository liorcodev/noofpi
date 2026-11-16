import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { PAYLOAD_KEY } from "../src/runtime/async-data";
import { DOOFPI_KEY } from "../src/runtime/doofpi-client";
import { useDoofpiFetch } from "../src/runtime/doofpi-fetch";

describe("useDoofpiFetch", () => {
  it("hands the doofpi client to the handler and transfers the result like useAsyncData", async () => {
    const client = { hello: { read: vi.fn(async () => "hi") } };
    const payload = {
      server: true,
      data: {} as Record<string, unknown>,
      errors: {},
    };
    const app = createSSRApp(
      defineComponent({
        setup() {
          const { data } = useDoofpiFetch("hello", (c: any) => c.hello.read());
          return () => h("p", String(data.value));
        },
      }),
    );
    app.provide(DOOFPI_KEY, { forPath: () => client } as any);
    app.provide(PAYLOAD_KEY, payload);
    expect(await renderToString(app)).toBe("<p>hi</p>");
    expect(payload.data).toEqual({ hello: "hi" });
  });

  it("uses the client of an explicit mode", async () => {
    const forMode = vi.fn(() => ({ hello: { read: async () => "from mode" } }));
    const app = createSSRApp(
      defineComponent({
        setup() {
          const { data } = useDoofpiFetch("m", (c: any) => c.hello.read(), {
            mode: "sfetch",
          });
          return () => h("p", String(data.value));
        },
      }),
    );
    app.provide(DOOFPI_KEY, { forPath: vi.fn(), forMode } as any);
    app.provide(PAYLOAD_KEY, { server: true, data: {}, errors: {} });
    expect(await renderToString(app)).toBe("<p>from mode</p>");
    expect(forMode).toHaveBeenCalledWith("sfetch");
  });

  it("throws outside of an app", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => useDoofpiFetch("k", async () => 1)).toThrow("inside setup()");
    warn.mockRestore();
  });
});
