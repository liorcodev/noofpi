import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizePath, type Plugin } from "vite";
import {
  toPublicConfig,
  toServerConfig,
  type ResolvedNoofpiConfig,
} from "../config";
import type { FontAssets } from "../fonts";
import { htmlTemplate } from "./template";
import { scanPageLayouts } from "./layouts";
import { scanPageMiddleware } from "./middleware";
import { presetEntryCode, readBuiltTemplate } from "./presets";
import {
  findLocaleFile,
  writeDoofpiTypes,
  writeI18nTypes,
  writeRouteTypes,
} from "./types";

const PREFIX = "virtual:noofpi/";
const VIRTUAL_IDS = [
  "config",
  "i18n",
  "routes",
  "layouts",
  "middleware",
  "plugins",
  "app-root",
  "error",
  "entry-client",
  "server",
  "entry",
  "template",
].map((name) => PREFIX + name);

export type BuildKind = "dev" | "client" | "server";

export const DEV_ENTRY = "/@id/__x00__virtual:noofpi/entry-client";

/** CSS files to load: the `css` option, else `app/assets/main.css`, else a generated Tailwind entry */
export function resolveCss(
  root: string,
  config: ResolvedNoofpiConfig,
  fonts: FontAssets,
): string[] {
  // @font-face rules come first so user styles can override them
  const generated = fonts.cssFile ? [fonts.cssFile] : [];
  if (config.css) {
    return [
      ...generated,
      ...config.css.map((file) => path.resolve(root, file)),
    ];
  }
  const main = path.join(root, "app/assets/main.css");
  if (existsSync(main)) return [...generated, main];
  if (!config.tailwind) return generated;
  const tailwindEntry = path.join(root, ".noofpi/tailwind.css");
  mkdirSync(path.dirname(tailwindEntry), { recursive: true });
  writeFileSync(tailwindEntry, '@import "tailwindcss";\n');
  return [...generated, tailwindEntry];
}

export function indexHtmlPath(root: string): string {
  return normalizePath(path.join(root, "index.html"));
}

export function noofpiPlugin(options: {
  root: string;
  config: ResolvedNoofpiConfig;
  css: string[];
}): Plugin {
  const { root, config, css } = options;
  const htmlId = indexHtmlPath(root);
  const file = (relative: string) => {
    const full = path.join(root, relative);
    return existsSync(full) ? normalizePath(full) : undefined;
  };
  const imp = (target: string) => JSON.stringify(normalizePath(target));
  let scannedPages = "";
  const scanPages = () =>
    JSON.stringify([scanPageLayouts(root), scanPageMiddleware(root)]);

  return {
    name: "noofpi",
    enforce: "pre",

    buildStart() {
      if (config.i18n) {
        if (!findLocaleFile(root, config.i18n.defaultLocale))
          this.error(
            `[noofpi] i18n.defaultLocale "${config.i18n.defaultLocale}" has no messages: create app/locales/${config.i18n.defaultLocale}.ts`,
          );
        for (const locale of config.i18n.locales)
          if (!findLocaleFile(root, locale))
            this.warn(
              `[noofpi] i18n locale "${locale}" has no file app/locales/${locale}.ts, it falls back to "${config.i18n.defaultLocale}"`,
            );
      }
      writeDoofpiTypes(root, config.doofpi.fetch);
      writeRouteTypes(root);
      writeI18nTypes(root, config.i18n);
    },

    // Page files added or removed change the typed `navigateTo()` paths, locale files the typed `t()` keys
    configureServer(server) {
      const onFile = (changed: string) => {
        const normalized = normalizePath(changed);
        if (normalized.endsWith(".vue") && normalized.includes("/app/pages/"))
          writeRouteTypes(root);
        else if (normalized.includes("/app/locales/"))
          writeI18nTypes(root, config.i18n);
      };
      server.watcher.on("add", onFile);
      server.watcher.on("unlink", onFile);
    },

    // `useLayout()` / `useMiddleware()` literals are baked into the routes module, so it must be rebuilt when one changes
    handleHotUpdate({ file, server }) {
      const changed = normalizePath(file);
      if (!changed.endsWith(".vue") || !changed.includes("/app/pages/")) return;
      if (scanPages() === scannedPages) return;
      for (const environment of Object.values(server.environments)) {
        const mod = environment.moduleGraph.getModuleById(
          "\0" + PREFIX + "routes",
        );
        if (mod) environment.moduleGraph.invalidateModule(mod);
      }
      server.ws.send({ type: "full-reload" });
      return [];
    },
    resolveId(source) {
      if (VIRTUAL_IDS.includes(source)) return "\0" + source;
      // The HTML shell is generated, so there is no index.html on disk
      if (source === htmlId) return htmlId;
    },

    load(id) {
      if (id === htmlId) return htmlTemplate("virtual:noofpi/entry-client");
      if (!id.startsWith("\0" + PREFIX)) return;
      const isServerConfig = this.environment?.config.consumer === "server";

      switch (id.slice(("\0" + PREFIX).length)) {
        case "config":
          return [
            `export const publicConfig = ${JSON.stringify(toPublicConfig(config))};`,
            `export const serverConfig = ${isServerConfig ? JSON.stringify(toServerConfig(config)) : "undefined"};`,
          ].join("\n");
        case "i18n":
          // The server renders synchronously, so it bundles every locale; the browser loads a locale when it is needed
          const glob = (eager: boolean) =>
            `import.meta.glob('/app/locales/*.{ts,js,json}', { ${eager ? "eager: true, " : ""}import: 'default' })`;
          return [
            `export const i18nConfig = ${JSON.stringify(config.i18n)};`,
            `export const messageFiles = ${config.i18n && isServerConfig ? glob(true) : "{}"};`,
            `export const messageLoaders = ${config.i18n && !isServerConfig ? glob(false) : "{}"};`,
          ].join("\n");
        case "routes": {
          const layouts = scanPageLayouts(root);
          const middleware = scanPageMiddleware(root);
          scannedPages = JSON.stringify([layouts, middleware]);
          return [
            `import { createRoutes } from 'noofpi/runtime/routes';`,
            `export default createRoutes(import.meta.glob('/app/pages/**/*.vue'), ${JSON.stringify(layouts)}, ${JSON.stringify(middleware)});`,
          ].join("\n");
        }
        case "layouts":
          return [
            `import { createLayouts } from 'noofpi/runtime/routes';`,
            `export default createLayouts(import.meta.glob('/app/layouts/*.vue', { eager: true, import: 'default' }));`,
          ].join("\n");
        case "middleware":
          return `export default import.meta.glob('/app/middleware/*.{ts,js}', { eager: true, import: 'default' });`;
        case "plugins":
          return `export default import.meta.glob('/app/plugins/*.{ts,js}', { eager: true, import: 'default' });`;
        case "app-root": {
          const appVue = file("app/app.vue");
          return appVue
            ? `export { default } from ${imp(appVue)};`
            : `export { default } from 'noofpi/runtime/default-app';`;
        }
        case "error": {
          const errorVue = file("app/error.vue");
          return errorVue
            ? `export { default } from ${imp(errorVue)};`
            : "export default undefined;";
        }
        case "entry-client":
          return [
            ...css.map((file) => `import ${imp(file)};`),
            `import { mount } from 'noofpi/runtime/entry-client';`,
            `mount();`,
          ].join("\n");
        case "entry":
          return presetEntryCode(config.build.preset, config);
        case "template":
          return `export default ${JSON.stringify(readBuiltTemplate(root))};`;
        case "server": {
          const userDoofpi = file("server/doofpi.ts");
          const userProxy = file("server/proxy.ts");
          const { ssr } = config;
          return [
            userDoofpi ? `import userDoofpi from ${imp(userDoofpi)};` : "",
            userProxy ? `import userProxyHook from ${imp(userProxy)};` : "",
            ssr ? `export { render } from 'noofpi/runtime/entry-server';` : "",
            `export const config = ${JSON.stringify(toServerConfig(config))};`,
            `export const doofpi = ${userDoofpi ? "userDoofpi" : "undefined"};`,
            `export const proxyHook = ${userProxy ? "userProxyHook" : "undefined"};`,
            `const serverMiddleware = import.meta.glob('/server/middleware/*.{ts,js}', { eager: true, import: 'default' });`,
            `export const middleware = Object.keys(serverMiddleware).sort().map((file) => serverMiddleware[file]);`,
          ]
            .filter(Boolean)
            .join("\n");
        }
      }
    },
  };
}
