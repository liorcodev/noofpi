import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { useLayout } from "../src/runtime/layout";
import { createLayoutComponent } from "../src/runtime/layout-component";
import {
  createLayouts,
  createRoutes,
  filePathToLayoutName,
  normalizeLayout,
} from "../src/runtime/routes";
import { extractLayout, scanPageLayouts } from "../src/vite/layouts";

const layout = (name: string) =>
  defineComponent({
    render() {
      return h("div", { class: name }, this.$slots.default?.());
    },
  });

const Page = defineComponent({ render: () => h("main", "page") });

const renderAt = async (
  path: string,
  pageLayout: string | false | undefined,
  layouts = createLayouts({
    "/app/layouts/default.vue": layout("default"),
    "/app/layouts/admin-panel.vue": layout("admin"),
  }),
) => {
  const routes = createRoutes(
    { "/app/pages/index.vue": (async () => Page) as any },
    {
      ...(pageLayout !== undefined && { "/app/pages/index.vue": pageLayout }),
    },
  );
  const router = createRouter({ history: createMemoryHistory(), routes });
  const NoofpiLayout = createLayoutComponent(layouts);
  const app = createSSRApp({ render: () => h(NoofpiLayout) });
  app.use(router);
  await router.push(path);
  return (await renderToString(app)).replace(/<!--[[\]]-->/g, "");
};

describe("layout names and routes", () => {
  it.each([
    ["/app/layouts/default.vue", "default"],
    ["/app/layouts/admin.vue", "admin"],
    ["/app/layouts/AdminPanel.vue", "admin-panel"],
  ])("%s -> %s", (file, name) => {
    expect(filePathToLayoutName(file)).toBe(name);
  });

  it("only accepts a string or false as a layout export", () => {
    expect(normalizeLayout("admin")).toBe("admin");
    expect(normalizeLayout(false)).toBe(false);
    expect(normalizeLayout(true)).toBeUndefined();
    expect(normalizeLayout(undefined)).toBeUndefined();
  });
});

describe("NoofpiLayout", () => {
  it("uses the default layout when the page does not export one", async () => {
    expect(await renderAt("/", undefined)).toBe(
      '<div class="default"><main>page</main></div>',
    );
  });

  it("uses the layout named by the page", async () => {
    expect(await renderAt("/", "admin-panel")).toBe(
      '<div class="admin"><main>page</main></div>',
    );
  });

  it("renders its slot instead of the page when given one", async () => {
    const NoofpiLayout = createLayoutComponent(
      createLayouts({ "/app/layouts/default.vue": layout("default") }),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: Page }],
    });
    const app = createSSRApp({
      render: () =>
        h(NoofpiLayout, null, {
          default: () => h("section", [h(RouterView)]),
        }),
    });
    app.use(router);
    await router.push("/");
    expect(await renderToString(app)).toBe(
      '<div class="default"><section><main>page</main></section></div>',
    );
  });

  it("renders the bare page for layout = false", async () => {
    expect(await renderAt("/", false)).toBe("<main>page</main>");
  });

  it("warns and renders the bare page for an unknown layout, and works without any layouts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await renderAt("/", "nope")).toBe("<main>page</main>");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown layout "nope"'),
    );
    warn.mockRestore();
    expect(await renderAt("/", undefined, {})).toBe("<main>page</main>");
  });
});

describe("extractLayout / scanPageLayouts", () => {
  it.each([
    [`useLayout('admin')`, "admin"],
    [`useLayout("admin-panel");`, "admin-panel"],
    [`useLayout( \`plain\` )`, "plain"],
    [`useLayout(false)`, false],
    [`const x = 1`, undefined],
    [`useLayout(name)`, undefined],
    ["useLayout(`a${b}`)", undefined],
  ])("%s -> %s", (source, expected) => {
    expect(extractLayout(source)).toBe(expected);
  });

  it("maps pages to glob-style keys and skips pages without useLayout", () => {
    const root = mkdtempSync(path.join(tmpdir(), "noofpi-"));
    try {
      mkdirSync(path.join(root, "app/pages/admin"), { recursive: true });
      writeFileSync(
        path.join(root, "app/pages/index.vue"),
        "<script setup>\n</script>",
      );
      writeFileSync(
        path.join(root, "app/pages/about.vue"),
        `<script setup>useLayout('plain')</script>`,
      );
      writeFileSync(
        path.join(root, "app/pages/admin/[id].vue"),
        `<script setup>useLayout(false)</script>`,
      );
      expect(scanPageLayouts(root)).toEqual({
        "/app/pages/about.vue": "plain",
        "/app/pages/admin/[id].vue": false,
      });
      expect(scanPageLayouts(path.join(root, "missing"))).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("useLayout", () => {
  const run = async (
    pageLayout: string | false | undefined,
    call: string | false,
  ) => {
    const Home = defineComponent({
      setup() {
        useLayout(call);
        return () => h("main");
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: Home, meta: { layout: pageLayout } }],
    });
    const app = createSSRApp({ render: () => h("div", h(Home)) });
    app.use(router);
    await router.push("/");
    await renderToString(app);
  };

  it("warns when the call was not picked up at build time, and stays quiet when it matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run("plain", "plain");
    expect(warn).not.toHaveBeenCalled();
    await run(undefined, "plain");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('useLayout("plain") was not picked up'),
    );
    warn.mockRestore();
  });
});
