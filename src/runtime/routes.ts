import type { Component } from "vue";
import type { RouteRecordRaw } from "vue-router";

const PAGES_DIR = "/app/pages/";

/** `/app/pages/users/[id].vue` -> `/users/:id` ; `index.vue` -> `/` ; `[...slug].vue` -> catch-all */
export function filePathToRoute(file: string): string {
  const relative = file
    .slice(file.indexOf(PAGES_DIR) + PAGES_DIR.length)
    .replace(/\.vue$/, "");
  const segments = relative
    .split("/")
    .filter(
      (segment, index, all) =>
        !(segment === "index" && index === all.length - 1),
    )
    .map((segment) => {
      const catchAll = /^\[\.\.\.(\w+)\]$/.exec(segment);
      if (catchAll) return `:${catchAll[1]}(.*)*`;
      const param = /^\[(\w+)\]$/.exec(segment);
      return param ? `:${param[1]}` : segment;
    });
  return "/" + segments.join("/");
}

export function createRoutes(
  pages: Record<string, () => Promise<unknown>>,
  layouts: Record<string, string | false> = {},
  middleware: Record<string, string[]> = {},
): RouteRecordRaw[] {
  return Object.entries(pages).map(([file, importPage]) => {
    const meta: Record<string, unknown> = {
      layout: layouts[file],
      middleware: middleware[file],
    };
    return {
      path: filePathToRoute(file),
      // The page's `definePage()` export is read once the module is imported, which the router awaits before it resolves a navigation
      component: async () => {
        const module = await importPage();
        meta.loader = (module as { page?: { loader?: unknown } } | undefined)
          ?.page?.loader;
        return module;
      },
      meta,
    } as RouteRecordRaw;
  });
}

/** `/app/layouts/AdminPanel.vue` -> `admin-panel` */
export function filePathToLayoutName(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.vue$/, "");
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function createLayouts(
  modules: Record<string, Component>,
): Record<string, Component> {
  return Object.fromEntries(
    Object.entries(modules).map(([file, component]) => [
      filePathToLayoutName(file),
      component,
    ]),
  );
}

/** A page's `layout` export: a layout name, `false` for no layout, anything else means "default" */
export function normalizeLayout(value: unknown): string | false | undefined {
  return typeof value === "string" || value === false ? value : undefined;
}
