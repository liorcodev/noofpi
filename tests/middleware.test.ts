import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, inject } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createMiddlewareGuard,
  createMiddlewareRegistry,
  parseMiddlewareFile,
  type RouteMiddleware,
} from "../src/runtime/middleware";
import { createRoutes } from "../src/runtime/routes";
import { extractMiddleware } from "../src/vite/middleware";

const Page = defineComponent({ render: () => h("main") });

const setup = (
  modules: Record<string, RouteMiddleware>,
  middleware: Record<string, string[]> = {},
) => {
  const routes = createRoutes(
    {
      "/app/pages/index.vue": (async () => Page) as any,
      "/app/pages/admin.vue": (async () => Page) as any,
      "/app/pages/login.vue": (async () => Page) as any,
    },
    {},
    middleware,
  );
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach(createMiddlewareGuard(createMiddlewareRegistry(modules)));
  return router;
};

describe("middleware files", () => {
  it.each([
    ["/app/middleware/auth.ts", "auth", false],
    ["/app/middleware/AuthAdmin.ts", "auth-admin", false],
    ["/app/middleware/log.global.ts", "log", true],
  ])("%s -> %s (global: %s)", (file, name, global) => {
    expect(parseMiddlewareFile(file)).toEqual({ name, global });
  });
});

describe("route middleware guard", () => {
  it("runs global middleware in file order, then the page's named middleware", async () => {
    const calls: string[] = [];
    const track =
      (name: string): RouteMiddleware =>
      () => {
        calls.push(name);
      };
    const router = setup(
      {
        "/app/middleware/b.global.ts": track("b"),
        "/app/middleware/a.global.ts": track("a"),
        "/app/middleware/auth.ts": track("auth"),
        "/app/middleware/unused.ts": track("unused"),
      },
      { "/app/pages/admin.vue": ["auth"] },
    );
    await router.push("/admin");
    expect(calls).toEqual(["a", "b", "auth"]);
    expect(router.currentRoute.value.path).toBe("/admin");
  });

  it("redirects on a location, aborts on false, and the first one stops the chain", async () => {
    const after = vi.fn();
    const router = setup(
      {
        "/app/middleware/auth.ts": (to) =>
          to.path === "/admin" ? "/login" : true,
        "/app/middleware/stop.ts": (to) =>
          to.path === "/" ? false : undefined,
        "/app/middleware/after.ts": after,
      },
      {
        "/app/pages/admin.vue": ["auth", "after"],
        "/app/pages/index.vue": ["stop", "after"],
      },
    );
    await router.push("/admin");
    expect(router.currentRoute.value.path).toBe("/login");
    expect(after).not.toHaveBeenCalled();

    expect(await router.push("/")).toBeTruthy();
    expect(router.currentRoute.value.path).toBe("/login");
    expect(after).not.toHaveBeenCalled();
  });

  it("awaits async middleware", async () => {
    const router = setup({
      "/app/middleware/slow.global.ts": async (to) => (
        await 0,
        to.path === "/admin" ? "/login" : undefined
      ),
    });
    await router.push("/admin");
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("fails closed for an unknown named middleware", async () => {
    const router = setup({}, { "/app/pages/admin.vue": ["nope"] });
    router.onError(() => {});
    await expect(router.push("/admin")).rejects.toThrow(
      'Unknown middleware "nope"',
    );
  });

  it("can use inject()-based composables", async () => {
    const KEY = Symbol("key");
    let seen: unknown;
    const router = setup({
      "/app/middleware/ctx.global.ts": () => {
        seen = inject(KEY, null);
      },
    });
    const app = createSSRApp({ render: () => h("div") });
    app.provide(KEY, "provided");
    app.use(router);
    await router.push("/");
    expect(seen).toBe("provided");
  });
});

describe("extractMiddleware", () => {
  it.each([
    [`useMiddleware('auth')`, ["auth"]],
    [`useMiddleware("auth");`, ["auth"]],
    [`useMiddleware(['auth', "admin"])`, ["auth", "admin"]],
    [`useMiddleware([])`, []],
    [`const x = 1`, undefined],
    [`// useMiddleware(name)\nuseMiddleware('auth')`, ["auth"]],
    [`/* useMiddleware(x) */ useMiddleware('auth')`, ["auth"]],
  ])("%s -> %j", (source, expected) => {
    expect(extractMiddleware(source)).toEqual(expected);
  });

  it.each([
    `useMiddleware(name)`,
    `useMiddleware(['auth', name])`,
    "useMiddleware(`a${b}`)",
    `useMiddleware('a'); useMiddleware('b')`,
  ])("throws for %s", (source) => {
    expect(() => extractMiddleware(source)).toThrow("useMiddleware()");
  });
});
