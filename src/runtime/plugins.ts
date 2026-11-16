import type { App } from "vue";
import type { Router } from "vue-router";

export interface NoofpiPluginContext {
  app: App;
  router: Router;
  /** `true` while rendering on the server */
  server: boolean;
}

/**
 * An `app/plugins/*.ts` default export. Runs once per app (once per request on the server) after noofpi's own
 * setup, so `app.use(...)`, `app.provide(...)` and composables (inside `app.runWithContext`) work.
 */
export type NoofpiPlugin = (context: NoofpiPluginContext) => void;

export function defineNoofpiPlugin(plugin: NoofpiPlugin): NoofpiPlugin {
  return plugin;
}

/** `/app/plugins/pinia.client.ts` runs only in the browser, `*.server.ts` only on the server */
export function pluginMode(file: string): "client" | "server" | "both" {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.[jt]s$/, "");
  if (base.endsWith(".client")) return "client";
  if (base.endsWith(".server")) return "server";
  return "both";
}

/** Plugins run in file-name order (prefix files with `01.`, `02.` to control it) */
export function runPlugins(
  modules: Record<string, NoofpiPlugin>,
  context: NoofpiPluginContext,
): void {
  for (const [file, plugin] of Object.entries(modules).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const mode = pluginMode(file);
    if (mode === "both" || (mode === "server") === context.server)
      plugin(context);
  }
}
