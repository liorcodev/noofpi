import { createServer } from "vite";
import type { ResolvedNoofpiConfig } from "../config";
import { createViteConfig } from "./config";

/**
 * Generates everything the editor and `vue-tsc` need from `.noofpi/` (routes, i18n, doofpi, auto-import and
 * component declarations) without starting a server. Vite runs the plugins' `buildStart` when the server is
 * created, which is where those files are written. Fonts are not downloaded, the declarations do not need them.
 */
export async function prepareApp(
  root: string,
  config: ResolvedNoofpiConfig,
): Promise<void> {
  const inline = createViteConfig(root, config, "dev");
  inline.logLevel = "warn";
  inline.server = { middlewareMode: true, hmr: false, watch: null };
  // Nothing is served, so there is nothing to prebundle
  inline.optimizeDeps = { noDiscovery: true, include: [] };
  const vite = await createServer(inline);
  await vite.close();
}
