import { describe, expect, it } from "vitest";
import { createApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  pluginMode,
  runPlugins,
  type NoofpiPlugin,
} from "../src/runtime/plugins";

const context = (server: boolean) => ({
  app: createApp({}),
  router: createRouter({ history: createMemoryHistory(), routes: [] }),
  server,
});

describe("plugins", () => {
  it.each([
    ["/app/plugins/pinia.ts", "both"],
    ["/app/plugins/analytics.client.ts", "client"],
    ["/app/plugins/seed.server.js", "server"],
  ])("%s -> %s", (file, mode) => {
    expect(pluginMode(file)).toBe(mode);
  });

  it("runs in file-name order and filters by side", () => {
    const calls: string[] = [];
    const plugin =
      (name: string): NoofpiPlugin =>
      () =>
        calls.push(name);
    const modules = {
      "/app/plugins/02.b.ts": plugin("b"),
      "/app/plugins/03.client.ts": plugin("client"),
      "/app/plugins/01.a.ts": plugin("a"),
      "/app/plugins/04.server.ts": plugin("server"),
    };
    runPlugins(modules, context(false));
    expect(calls).toEqual(["a", "b", "client"]);
    calls.length = 0;
    runPlugins(modules, context(true));
    expect(calls).toEqual(["a", "b", "server"]);
  });
});
