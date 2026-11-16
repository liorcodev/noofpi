import { describe, expect, it } from "vitest";
import { filePathToRoute } from "../src/runtime/routes";

describe("filePathToRoute", () => {
  it.each([
    ["/app/pages/index.vue", "/"],
    ["/app/pages/about.vue", "/about"],
    ["/app/pages/blog/index.vue", "/blog"],
    ["/app/pages/users/[id].vue", "/users/:id"],
    ["/app/pages/docs/[...slug].vue", "/docs/:slug(.*)*"],
    ["/app/pages/a/b/c.vue", "/a/b/c"],
  ])("%s -> %s", (file, route) => {
    expect(filePathToRoute(file)).toBe(route);
  });
});
