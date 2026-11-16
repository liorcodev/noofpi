import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  PAYLOAD_KEY,
  type NoofpiPayloadState,
} from "../src/runtime/async-data";
import {
  definePage,
  installLoaders,
  LOADER_KEY,
  useLoaderData,
  type PageDefinition,
} from "../src/runtime/loader";
import { linkPrefetchTarget } from "../src/runtime/prefetch";
import { createRoutes } from "../src/runtime/routes";

const Plain = defineComponent({ render: () => h("main") });

const state = (
  server: boolean,
  init: Partial<NoofpiPayloadState> = {},
): NoofpiPayloadState => ({ server, data: {}, errors: {}, ...init });

function setup(
  pages: Record<string, PageDefinition<unknown> | undefined>,
  payload: NoofpiPayloadState,
  Page = Plain,
) {
  const routes = createRoutes(
    Object.fromEntries(
      Object.entries(pages).map(([file, page]) => [
        file,
        (async () => ({ default: Page, page })) as any,
      ]),
    ),
  );
  const router = createRouter({ history: createMemoryHistory(), routes });
  const loaders = installLoaders(router, {
    payload,
    run: (_to, call) => call(),
  });
  return { router, loaders };
}

describe("page loaders", () => {
  it("run before the page is shown, with the route's params and query", async () => {
    const loader = vi.fn(({ params, query }) => ({ params, query }));
    const { router, loaders } = setup(
      { "/app/pages/users/[id].vue": definePage({ loader }) },
      state(false),
    );
    await router.push("/users/5?tab=a");
    expect(loader).toHaveBeenCalledOnce();
    expect(loaders.state.current.value?.data).toEqual({
      params: { id: "5" },
      query: { tab: "a" },
    });
  });

  it("run after the middleware redirected: only the final page's loader runs", async () => {
    const first = vi.fn(() => 1);
    const second = vi.fn(() => 2);
    const { router } = setup(
      {
        "/app/pages/a.vue": definePage({ loader: first }),
        "/app/pages/b.vue": definePage({ loader: second }),
      },
      state(false),
    );
    router.beforeEach((to) => (to.path === "/a" ? "/b" : undefined));
    await router.push("/a");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("record data and errors in the payload on the server", async () => {
    const payload = state(true);
    const { router } = setup(
      {
        "/app/pages/ok.vue": definePage({ loader: async () => undefined }),
        "/app/pages/bad.vue": definePage({
          loader: () => {
            throw Object.assign(new Error("nope"), { status: 403 });
          },
        }),
      },
      payload,
    );
    await router.push("/ok");
    await router.push("/bad");
    expect(payload.data).toEqual({ "loader:/ok": null });
    expect(payload.errors).toEqual({
      "loader:/bad": { message: "Internal Server Error", status: 403 },
    });
  });

  it("hydrate from the payload without running again", async () => {
    const loader = vi.fn(() => "fresh");
    const { router, loaders } = setup(
      { "/app/pages/a.vue": definePage({ loader }) },
      state(false, { data: { "loader:/a": "from server" } }),
    );
    await router.push("/a");
    expect(loader).not.toHaveBeenCalled();
    expect(loaders.state.current.value?.data).toBe("from server");
  });

  it("do not leak the data of a cancelled navigation", async () => {
    const { router, loaders } = setup(
      {
        "/app/pages/a.vue": definePage({ loader: () => "a" }),
        "/app/pages/b.vue": definePage({ loader: () => "b" }),
      },
      state(false),
    );
    await router.push("/a");
    router.beforeEach((to) => (to.path === "/b" ? false : undefined));
    await router.push("/b");
    expect(loaders.state.current.value?.data).toBe("a");
  });

  it("clear the data when navigating to a page without a loader, and run again on return", async () => {
    const loader = vi.fn(() => "a");
    const { router, loaders } = setup(
      {
        "/app/pages/a.vue": definePage({ loader }),
        "/app/pages/plain.vue": undefined,
      },
      state(false),
    );
    await router.push("/a");
    await router.push("/plain");
    expect(loaders.state.current.value).toBeUndefined();
    await router.push("/a");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("refresh runs the loader of the current route again", async () => {
    let n = 0;
    const { router, loaders } = setup(
      { "/app/pages/a.vue": definePage({ loader: () => ++n }) },
      state(false),
    );
    await router.push("/a");
    await loaders.state.refresh();
    expect(loaders.state.current.value?.data).toBe(2);
  });

  it("prefetch runs the loader ahead of the navigation, which then reuses the result", async () => {
    const loader = vi.fn(() => "data");
    const { router, loaders } = setup(
      {
        "/app/pages/index.vue": undefined,
        "/app/pages/a.vue": definePage({ loader }),
      },
      state(false),
    );
    await router.push("/");
    await loaders.prefetch("/a");
    await loaders.prefetch("/a");
    expect(loader).toHaveBeenCalledOnce();
    await router.push("/a");
    expect(loader).toHaveBeenCalledOnce();
    expect(loaders.state.current.value?.data).toBe("data");
  });
});

describe("useLoaderData", () => {
  it("renders the data the loader produced during SSR", async () => {
    const page = definePage({ loader: async () => ({ name: "Ada" }) });
    const Page = defineComponent({
      setup() {
        const { data } = useLoaderData(page);
        return () => h("p", data.value?.name);
      },
    });
    const payload = state(true);
    const { router, loaders } = setup(
      { "/app/pages/a.vue": page },
      payload,
      Page,
    );
    const app = createSSRApp({ render: () => h("div", h(Page)) });
    app.use(router);
    app.provide(PAYLOAD_KEY, payload);
    app.provide(LOADER_KEY, loaders.state);
    await router.push("/a");
    expect(await renderToString(app)).toContain("<p>Ada</p>");
  });
});

describe("linkPrefetchTarget", () => {
  const link = (attrs: Record<string, string>) => {
    const anchor = {
      href: attrs.href,
      target: attrs.target ?? "",
      hasAttribute: (name: string) => name in attrs,
    };
    return { closest: () => anchor } as unknown as EventTarget;
  };
  const origin = "https://app.test";

  it("returns the path of an internal link", () => {
    expect(
      linkPrefetchTarget(
        link({ href: "https://app.test/users/5?a=1#x" }),
        origin,
      ),
    ).toBe("/users/5?a=1");
  });

  it.each([
    ["external", { href: "https://other.test/a" }],
    ["download", { href: "https://app.test/a", download: "" }],
    ["opted out", { href: "https://app.test/a", "data-no-prefetch": "" }],
    ["new tab", { href: "https://app.test/a", target: "_blank" }],
  ])("ignores a %s link", (_, attrs) => {
    expect(linkPrefetchTarget(link(attrs), origin)).toBeUndefined();
  });
});
