import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { mergeConfig, type InlineConfig } from "vite";
import type { ResolvedNoofpiConfig } from "../config";
import { fontThemePlugin, NO_FONTS, type FontAssets } from "../fonts";
import { autoImportPlugins } from "./auto-imports";
import { imagesPlugin } from "./images";
import {
  indexHtmlPath,
  noofpiPlugin,
  resolveCss,
  type BuildKind,
} from "./plugin";
import { OUTPUT_DIR, serverBuildConfig } from "./presets";
import { tailwindPlugin } from "./tailwind";

export { OUTPUT_DIR };

export function createViteConfig(
  root: string,
  config: ResolvedNoofpiConfig,
  kind: BuildKind,
  fonts: FontAssets = NO_FONTS,
): InlineConfig {
  const base: InlineConfig = {
    root,
    configFile: false,
    appType: "custom",
    logLevel: "info",
    plugins: [
      vue(),
      // Must come before Tailwind so the theme is in the stylesheet by the time Tailwind compiles it
      config.tailwind && fonts.theme ? fontThemePlugin(fonts.theme) : null,
      config.tailwind ? tailwindPlugin() : null,
      config.autoImports ? autoImportPlugins() : null,
      imagesPlugin(config.images),
      noofpiPlugin({ root, config, css: resolveCss(root, config, fonts) }),
    ],
    resolve: {
      dedupe: ["vue", "vue-router"],
      // vue-router reports through `nostics`; the stub keeps the console free of its warnings
      alias: {
        nostics: fileURLToPath(
          new URL("./runtime/silent-diagnostics.js", import.meta.url),
        ),
      },
    },
    // noofpi's runtime imports virtual modules, so it must go through vite instead of being externalized
    // vue-router too: its `nostics` import has to go through the alias above
    ssr: { noExternal: ["noofpi", "vue-router"] },
    // Subpaths must be listed too: a prebundled `noofpi/runtime` would be a second copy of the runtime modules
    // (different injection keys than the ones `createNoofpiApp` provides)
    optimizeDeps: {
      exclude: ["noofpi", "noofpi/runtime", "noofpi/runtime/routes"],
      // The generated index.html has no imports vite can scan, so these would otherwise be found one by one
      // on the first page load, each triggering a re-bundle and a full reload
      include: ["vue", "vue-router", "doofpi"],
    },
  };

  if (kind === "client") {
    base.build = {
      outDir: path.join(root, OUTPUT_DIR, "public"),
      emptyOutDir: true,
      rollupOptions: { input: indexHtmlPath(root) },
    };
  } else if (kind === "server") {
    base.publicDir = false;
    return mergeConfig(
      mergeConfig(base, serverBuildConfig(root, config.build.preset)),
      config.vite as InlineConfig,
    );
  }

  return mergeConfig(base, config.vite as InlineConfig);
}
