import { describe, expect, it, vi } from "vitest";
import { createHandler } from "../src/server/handler";
import { getRequestCookies } from "../src/server/cookies";
import {
  SSR_OUTLET,
  type ServerConfig,
  type ServerModule,
} from "../src/server/types";

const template = `<html lang="en"><head><title>noofpi</title></head><body><div id="app">${SSR_OUTLET}</div></body></html>`;

const setup = (
  overrides: Partial<ServerModule> = {},
  config: Partial<ServerConfig> = {},
) => {
  const doofpi = { fetch: vi.fn(async () => new Response("api")) };
  const render = vi.fn(async () => ({ html: "<p>rendered</p>", status: 200 }));
  const mod: ServerModule = {
    config: {
      ssr: true,
      doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
      ...config,
    },
    doofpi,
    render,
    ...overrides,
  };
  const handler = createHandler({
    load: async () => mod,
    getTemplate: async () => template,
  });
  return { handler, doofpi, render };
};

const get = (path: string, init?: RequestInit) =>
  new Request("http://localhost" + path, init);

describe("createHandler", () => {
  it("routes the doofpi root to the local doofpi instance", async () => {
    const { handler, doofpi, render } = setup();
    expect(await (await handler(get("/doofpi.users.get"))).text()).toBe("api");
    expect(doofpi.fetch).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });

  it("does not treat pages that merely start with the root as api", async () => {
    const { handler, doofpi } = setup();
    expect(await (await handler(get("/doofpix"))).text()).toContain("rendered");
    expect(doofpi.fetch).not.toHaveBeenCalled();
  });

  it("renders pages into the template with the status from render", async () => {
    const { handler, render } = setup({
      render: vi.fn(async () => ({ html: "nf", status: 404 })),
    });
    const response = await handler(get("/missing"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(
      `<html lang="en"><head><title>noofpi</title></head><body><div id="app">nf</div></body></html>`,
    );
    expect(render).not.toHaveBeenCalled();
  });

  it("serves the empty shell when ssr is off", async () => {
    const { handler, render } = setup({}, { ssr: false });
    expect(await (await handler(get("/"))).text()).toBe(
      '<html lang="en"><head><title>noofpi</title></head><body><div id="app"></div></body></html>',
    );
    expect(render).not.toHaveBeenCalled();
  });

  it("serves the shell without rendering for routeRules with ssr: false", async () => {
    const { handler, render } = setup(
      {},
      {
        routeRules: { "/admin/**": { ssr: false } },
        head: { title: "%s | Site" },
      },
    );
    const admin = await (await handler(get("/admin/users"))).text();
    expect(admin).toContain('<div id="app"></div>');
    expect(admin).toContain("<title>Site</title>");
    expect(render).not.toHaveBeenCalled();
    expect(await (await handler(get("/blog"))).text()).toContain("rendered");
    expect(render).toHaveBeenCalledOnce();
  });

  it("writes the head from render into the shell, before the rendered markup", async () => {
    const { handler } = setup({
      render: async () => ({
        html: "<title>not the head</title>",
        status: 200,
        head: {
          title: "A & B",
          meta: [{ name: "description", content: 'say "hi"' }],
          link: [],
          htmlAttrs: { lang: "he" },
          bodyAttrs: {},
        },
      }),
    });
    const html = await (await handler(get("/"))).text();
    expect(html).toContain("<title>A &amp; B</title>");
    expect(html).toContain(
      '<meta name="description" content="say &quot;hi&quot;" data-noofpi-head="" />',
    );
    expect(html).toContain('<html lang="he" data-noofpi-attrs="lang">');
    expect(html).toContain('<div id="app"><title>not the head</title></div>');
  });

  it("gives render an in-process fetch that reaches the handler, with the cookie", async () => {
    let inProcess: string | undefined;
    const { handler, doofpi } = setup({
      render: async (_url, ctx) => {
        inProcess = await (
          await ctx.fetch("http://localhost/doofpi.x", {
            headers: { cookie: ctx.cookie! },
          })
        ).text();
        return { html: "ok", status: 200 };
      },
    });
    await handler(get("/", { headers: { cookie: "sid=1" } }));
    expect(inProcess).toBe("api");
    expect(
      new Headers((doofpi.fetch.mock.calls[0] as any)[0].headers).get("cookie"),
    ).toBe("sid=1");
  });

  it("only mounts the proxy for pfetch", async () => {
    const { handler: lfetch } = setup();
    expect((await lfetch(get("/_noofpi/proxy/doofpi.x"))).status).toBe(404);

    const { handler: pfetch } = setup(
      {},
      {
        doofpi: {
          fetch: "pfetch",
          url: "https://api.example.com",
          root: "/doofpi",
        },
      },
    );
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("remote")) as unknown as typeof fetch;
    try {
      expect(await (await pfetch(get("/_noofpi/proxy/doofpi.x"))).text()).toBe(
        "remote",
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("mounts the proxy when only a route rule uses pfetch", async () => {
    const { handler } = setup(
      {},
      {
        doofpi: {
          fetch: "lfetch",
          url: "https://api.example.com",
          root: "/doofpi",
        },
        routeRules: { "/admin/**": { fetch: "pfetch" } },
      },
    );
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("remote")) as unknown as typeof fetch;
    try {
      expect(await (await handler(get("/_noofpi/proxy/doofpi.x"))).text()).toBe(
        "remote",
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("redirects when render reports a middleware redirect", async () => {
    const { handler } = setup({
      render: async () => ({ html: "", status: 302, redirect: "/login" }),
    });
    const response = await handler(get("/admin"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(await response.text()).toBe("");
  });

  describe("server middleware", () => {
    it("wraps every request in file order, outermost first, and can change the response", async () => {
      const order: string[] = [];
      const { handler, render } = setup({
        middleware: [
          async (_ctx, next) => {
            order.push("a in");
            const response = await next();
            order.push("a out");
            return new Response(response.body, {
              status: response.status,
              headers: { "x-mw": "a" },
            });
          },
          async (_ctx, next) => {
            order.push("b");
            return next();
          },
        ],
      });
      const response = await handler(get("/"));
      expect(response.headers.get("x-mw")).toBe("a");
      expect(await response.text()).toContain("rendered");
      expect(order).toEqual(["a in", "b", "a out"]);
      expect(render).toHaveBeenCalledOnce();
    });

    it("short-circuits without reaching the page or the api, and sees the url and env", async () => {
      const seen: unknown[] = [];
      const { handler, doofpi, render } = setup({
        middleware: [
          (ctx) => {
            seen.push(ctx.url.pathname, ctx.env);
            return new Response("denied", { status: 401 });
          },
        ],
      });
      const response = await handler(get("/doofpi.x"), "env");
      expect(response.status).toBe(401);
      expect(seen).toEqual(["/doofpi.x", "env"]);
      expect(doofpi.fetch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    });

    it("500s when a middleware does not return a Response", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { handler } = setup({
        middleware: [(async () => undefined) as never],
      });
      expect((await handler(get("/"))).status).toBe(500);
    });
  });

  describe("cookies", () => {
    it("lets middleware read, set and remove cookies, also when it short-circuits", async () => {
      const { handler } = setup({
        middleware: [
          ({ cookies }) => {
            cookies.set("seen", cookies.get("sid") ?? "none");
            cookies.remove("old");
            return new Response("denied", { status: 401 });
          },
        ],
      });
      const response = await handler(
        get("/", { headers: { cookie: "sid=abc; old=1" } }),
      );
      expect(response.headers.getSetCookie()).toEqual([
        "seen=abc; Path=/; HttpOnly; SameSite=Lax",
        "old=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
      ]);
    });

    it("marks cookies Secure over https only", async () => {
      const { handler } = setup({
        middleware: [
          ({ cookies }) => {
            cookies.set("a", "1");
            return new Response("ok");
          },
        ],
      });
      const https = await handler(new Request("https://localhost/"));
      expect(https.headers.get("set-cookie")).toContain("; Secure");
      const http = await handler(get("/"));
      expect(http.headers.get("set-cookie")).not.toContain("Secure");
    });

    it("hands the jar to render and sends what it sets", async () => {
      const { handler } = setup({
        render: async (_url, { cookies }) => {
          cookies.set(
            "theme",
            cookies.get("theme") === "dark" ? "light" : "dark",
          );
          return { html: "<p>rendered</p>", status: 200 };
        },
      });
      const response = await handler(
        get("/", { headers: { cookie: "theme=dark" } }),
      );
      expect(response.headers.getSetCookie()).toEqual([
        "theme=light; Path=/; HttpOnly; SameSite=Lax",
      ]);
    });

    it("lets the api set cookies through getRequestCookies(req)", async () => {
      const doofpi = {
        fetch: vi.fn(async (req: Request) => {
          getRequestCookies(req).set("session", "s1", { maxAge: 60 });
          return Response.json({ ok: true });
        }),
      };
      const { handler } = setup({ doofpi });
      const response = await handler(get("/doofpi.login"));
      expect(response.headers.getSetCookie()).toEqual([
        "session=s1; Path=/; Max-Age=60; HttpOnly; SameSite=Lax",
      ]);
      expect(() => getRequestCookies(get("/"))).toThrow(/original Request/);
    });
  });

  it("404s unknown files, 405s other methods and 500s on failures", async () => {
    const { handler } = setup();
    expect((await handler(get("/favicon.ico"))).status).toBe(404);
    expect((await handler(get("/page", { method: "POST" }))).status).toBe(405);

    const onError = vi.fn();
    const failing = createHandler({
      load: async () => {
        throw new Error("boom");
      },
      getTemplate: async () => template,
      onError,
    });
    expect((await failing(get("/"))).status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });
});
