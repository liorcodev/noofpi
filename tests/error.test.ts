import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  createError,
  isNoofpiError,
  parseErrorData,
  toErrorData,
} from "../src/error";
import { injectPayload } from "../src/payload";
import {
  createRootComponent,
  ERROR_KEY,
  notFoundError,
  showError,
  useError,
  type ErrorState,
} from "../src/runtime/error";
import { createHandler } from "../src/server/handler";
import { SSR_OUTLET } from "../src/server/types";

describe("createError", () => {
  it("defaults to a 500 and fills in the status text", () => {
    const error = createError({});
    expect(isNoofpiError(error)).toBe(true);
    expect(error).toMatchObject({
      statusCode: 500,
      statusMessage: "Internal Server Error",
      message: "Internal Server Error",
    });
    expect(createError({ statusCode: 404 }).statusMessage).toBe("Not Found");
    expect(createError("boom").message).toBe("boom");
  });

  it("only accepts error statuses", () => {
    expect(createError({ statusCode: 200 }).statusCode).toBe(500);
    expect(createError({ statusCode: 302 }).statusCode).toBe(500);
    expect(createError({ statusCode: 99999 }).statusCode).toBe(500);
    expect(createError({ statusCode: 418 }).statusCode).toBe(418);
  });
});

describe("toErrorData", () => {
  it("exposes the details of createError errors", () => {
    expect(
      toErrorData(createError({ statusCode: 403, message: "no" }), "/x"),
    ).toEqual({
      statusCode: 403,
      statusMessage: "Forbidden",
      message: "no",
      url: "/x",
    });
  });

  it("hides the message of unexpected errors", () => {
    const data = toErrorData(new Error("db password is hunter2"), "/x");
    expect(data.statusCode).toBe(500);
    expect(JSON.stringify(data)).not.toContain("hunter2");
  });
});

describe("error payload", () => {
  it("is embedded in the page and parsed back", () => {
    const error = notFoundError("/nope");
    const html = injectPayload("<body></body>", {
      data: {},
      errors: {},
      error,
    });
    const json = /<script[^>]*>(.*)<\/script>/.exec(html)![1]!;
    expect(parseErrorData(JSON.parse(json).error)).toEqual(error);
  });

  it("rejects malformed errors", () => {
    expect(parseErrorData(null)).toBeUndefined();
    expect(parseErrorData({ statusCode: "404" })).toBeUndefined();
  });
});

describe("error page component", () => {
  const ErrorPage = defineComponent({
    props: { error: { type: Object, required: true } },
    render() {
      return h(
        "p",
        `error ${(this.error as { statusCode: number }).statusCode}`,
      );
    },
  });
  const App = defineComponent({ render: () => h("main", "app") });

  const renderWith = (error: ErrorState, setup?: () => void) => {
    const Root = createRootComponent(
      setup ? defineComponent({ setup, render: () => h("main") }) : App,
      ErrorPage,
    );
    const app = createSSRApp(Root);
    app.provide(ERROR_KEY, error);
    return renderToString(app);
  };

  it("renders the app until an error is set", async () => {
    expect(await renderWith(ref(null))).toBe("<main>app</main>");
    expect(await renderWith(ref(notFoundError("/x")))).toBe("<p>error 404</p>");
  });

  it("shows errors raised with showError()", async () => {
    const error: ErrorState = ref(null);
    await renderWith(error, () => {
      showError({ statusCode: 403 });
    });
    expect(error.value?.statusCode).toBe(403);
  });

  it("exposes the state through useError()", async () => {
    const error: ErrorState = ref(notFoundError("/x"));
    const seen: unknown[] = [];
    const Reader = defineComponent({
      setup() {
        seen.push(useError());
        return () => null;
      },
    });
    const app = createSSRApp(Reader);
    app.provide(ERROR_KEY, error);
    await renderToString(app);
    expect(seen[0]).toBe(error);
  });
});

describe("createHandler with an error page", () => {
  const template = `<html><head></head><body><div id="app">${SSR_OUTLET}</div></body></html>`;
  const setup = (failure?: unknown) => {
    const onError = vi.fn();
    const handler = createHandler({
      load: async () => ({
        config: {
          ssr: true,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
        },
        render: async () => ({
          html: "<p>error 500</p>",
          status: 500,
          error: failure,
          payload: { data: {}, errors: {}, error: notFoundError("/") },
        }),
      }),
      getTemplate: async () => template,
      onError,
    });
    return { handler, onError };
  };

  it("answers with the error page and reports an unexpected error", async () => {
    const failure = new Error("bug");
    const { handler, onError } = setup(failure);
    const response = await handler(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("<p>error 500</p>");
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("does not report when there is no unexpected error", async () => {
    const { handler, onError } = setup();
    await handler(new Request("http://localhost/boom"));
    expect(onError).not.toHaveBeenCalled();
  });
});
