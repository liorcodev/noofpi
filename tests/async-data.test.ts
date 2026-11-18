import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createError } from "../src/error";
import { injectPayload, serializePayload } from "../src/payload";
import { parseEntries } from "../src/requests";
import {
  PAYLOAD_KEY,
  useAsyncData,
  type NoofpiPayloadState,
} from "../src/runtime/async-data";

const render = async (
  payload: NoofpiPayloadState,
  handler: () => Promise<unknown>,
  options?: { server?: boolean },
) => {
  const Comp = defineComponent({
    setup() {
      const { data, error, pending } = useAsyncData("k", handler, options);
      return () =>
        h(
          "p",
          pending.value
            ? "pending"
            : error.value
              ? `error:${error.value.message}`
              : JSON.stringify(data.value),
        );
    },
  });
  const app = createSSRApp(Comp);
  app.provide(PAYLOAD_KEY, payload);
  return renderToString(app);
};

const state = (
  server: boolean,
  init: Partial<NoofpiPayloadState> = {},
): NoofpiPayloadState => ({
  server,
  data: {},
  errors: {},
  ...init,
});

describe("useAsyncData", () => {
  it("fetches during SSR, renders the data and records it in the payload", async () => {
    const payload = state(true);
    const html = await render(payload, async () => ({ n: 1 }));
    expect(html).toContain("{&quot;n&quot;:1}");
    expect(payload.data).toEqual({ k: { n: 1 } });
  });

  it("records errors in the payload, hiding the message of unexpected ones", async () => {
    const payload = state(true);
    const html = await render(payload, () =>
      Promise.reject(
        Object.assign(new Error("db down at 10.0.0.5"), { status: 418 }),
      ),
    );
    expect(html).toContain("error:Internal Server Error");
    expect(html).not.toContain("10.0.0.5");
    expect(payload.errors).toEqual({
      k: { message: "Internal Server Error", status: 418 },
    });
    expect(payload.data).toEqual({});
  });

  it("keeps the message of createError() errors", async () => {
    const payload = state(true);
    const html = await render(payload, () =>
      Promise.reject(createError({ statusCode: 404, message: "no such item" })),
    );
    expect(html).toContain("error:no such item");
    expect(payload.errors.k?.message).toBe("no such item");
  });

  it("keeps the message and status of doofpi API errors", async () => {
    const payload = state(true);
    const failure = Object.assign(new Error("Invalid credentials"), {
      name: "DoofpiClientError",
      status: 401,
    });
    const html = await render(payload, () => Promise.reject(failure));
    expect(html).toContain("error:Invalid credentials");
    expect(payload.errors).toEqual({
      k: { message: "Invalid credentials", status: 401 },
    });
  });

  it("hydrates from the payload in the browser without calling the handler", async () => {
    const handler = vi.fn(async () => "fresh");
    const html = await render(
      state(false, { data: { k: "from-server" } }),
      handler,
    );
    expect(html).toContain("from-server");
    expect(handler).not.toHaveBeenCalled();
  });

  it("hydrates server errors too", async () => {
    const handler = vi.fn(async () => "fresh");
    const html = await render(
      state(false, { errors: { k: { message: "boom" } } }),
      handler,
    );
    expect(html).toContain("error:boom");
    expect(handler).not.toHaveBeenCalled();
  });

  it("fetches in the browser when there is no payload entry (client navigation)", async () => {
    const handler = vi.fn(async () => "fresh");
    const html = await render(state(false), handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(html).toContain("pending");
  });

  it("skips the server fetch with server: false", async () => {
    const handler = vi.fn(async () => "x");
    const payload = state(true);
    const html = await render(payload, handler, { server: false });
    expect(handler).not.toHaveBeenCalled();
    expect(html).toContain("pending");
    expect(payload.data).toEqual({});
  });
});

describe("payload serialization", () => {
  it("escapes html so data cannot break out of the script tag", () => {
    const script = serializePayload({
      data: { k: "</script><script>alert(1)</script>" },
      errors: {},
    });
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    const json = script
      .replace(/^<script[^>]*>/, "")
      .replace(/<\/script>$/, "");
    expect(JSON.parse(json).data.k).toBe("</script><script>alert(1)</script>");
  });

  it("injects before </body> and skips empty payloads", () => {
    const html = "<body><div></div></body>";
    expect(injectPayload(html, { data: {}, errors: {} })).toBe(html);
    expect(injectPayload(html, { data: { a: 1 }, errors: {} })).toMatch(
      /<\/div><script type="application\/json" id="__noofpi_payload__">.*<\/script><\/body>$/,
    );
  });

  it("carries the server's dev requests, ignoring malformed entries", () => {
    const request = {
      side: "server",
      mode: "lfetch",
      transport: "in-process",
      method: "GET",
      url: "/doofpi.hello",
      status: 200,
      ms: 3,
    } as const;
    expect(
      injectPayload("<body></body>", {
        data: {},
        errors: {},
        requests: [request],
      }),
    ).toContain('"requests":[');
    expect(parseEntries([request, { side: "nope" }, null])).toEqual([request]);
  });
});
