import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  fillRoutePath,
  navigateTo,
  setBrowserRouter,
} from "../src/runtime/navigate";
import { routeTypes } from "../src/vite/types";

declare module "../src/runtime/doofpi-client" {
  interface Register {
    pages: {
      "/": {};
      "/users/:id": { id: string | number };
    };
  }
}

// Compile-time checks: `tsc` fails when a `@ts-expect-error` line stops being an error
export function typeChecks() {
  navigateTo("/users/:id", { params: { id: 1 } });
  navigateTo("/");
  navigateTo("/users/5");
  navigateTo({ path: "/users/5" });
  // @ts-expect-error params are required
  navigateTo("/users/:id");
  // @ts-expect-error wrong param name
  navigateTo("/users/:id", { params: { slug: "a" } });
}

describe("fillRoutePath", () => {
  it("fills params and encodes them", () => {
    expect(fillRoutePath("/users/:id", { id: 5 })).toBe("/users/5");
    expect(fillRoutePath("/u/:a/p/:b", { a: "x y", b: "1/2" })).toBe(
      "/u/x%20y/p/1%2F2",
    );
  });

  it("joins catch-all params, which may be empty", () => {
    const pattern = "/docs/:slug(.*)*";
    expect(fillRoutePath(pattern, { slug: ["a", "b"] })).toBe("/docs/a/b");
    expect(fillRoutePath(pattern, { slug: [] })).toBe("/docs");
  });

  it("throws on a missing param", () => {
    expect(() => fillRoutePath("/users/:id", {})).toThrow(/"id"/);
  });
});

describe("routeTypes", () => {
  it("registers every page with its params", () => {
    const dts = routeTypes(["/users/:id", "/", "/docs/:slug(.*)*"]);
    expect(dts).toContain('"/": {};');
    expect(dts).toContain('"/users/:id": { id: string | number };');
    expect(dts).toContain('"/docs/:slug(.*)*": { slug: string[] };');
  });
});

describe("navigateTo", () => {
  it("navigates to a typed path with params, query and replace", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: {} },
        { path: "/users/:id", component: {} },
      ],
    });
    setBrowserRouter(router);
    await navigateTo("/users/:id", {
      params: { id: 7 },
      query: { tab: "a" },
    });
    expect(router.currentRoute.value.fullPath).toBe("/users/7?tab=a");
    await navigateTo("/", { replace: true });
    expect(router.currentRoute.value.fullPath).toBe("/");
    setBrowserRouter(undefined);
  });
});
