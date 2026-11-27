import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import type { PluginOption } from "vite";

/** Composables and components exported by noofpi's runtime that are available without an import */
export const RUNTIME_IMPORTS = [
  "useAsyncData",
  "useState",
  "clearError",
  "createError",
  "showError",
  "useError",
  "useCookie",
  "useCookies",
  "useDoofpi",
  "useDoofpiFetch",
  "useDoofpiForm",
  "useHead",
  "useLayout",
  "definePage",
  "useLoaderData",
  "useMiddleware",
  "defineRouteMiddleware",
  "defineNoofpiPlugin",
  "navigateTo",
  "useI18n",
  "defineMessages",
];
export const RUNTIME_COMPONENTS = [
  "ClientOnly",
  "NoofpiImage",
  "NoofpiLayout",
  "NoofpiLink",
  "NoofpiPage",
];

/**
 * Nuxt-style auto-imports:
 * - Vue and vue-router APIs (`ref`, `computed`, `useRoute`, ...) and noofpi's composables
 * - exports of `app/composables` and `app/utils` (top-level files and `*\/index` of sub-folders)
 * - components in `app/components` (names follow the path, `components/base/Button.vue` -> `BaseButton`)
 * Type declarations are written to `.noofpi/` so editors and `vue-tsc` know about them.
 */
export function autoImportPlugins(): PluginOption[] {
  return [
    AutoImport({
      imports: ["vue", "vue-router", { "noofpi/runtime": RUNTIME_IMPORTS }],
      dirs: [
        "app/composables",
        "app/composables/*/index.{ts,js}",
        "app/utils",
        "app/utils/*/index.{ts,js}",
      ],
      include: [/\.[jt]sx?$/, /\.vue$/, /\.vue\?vue/],
      // Without it a util used only in a template compiles to `_ctx.name` and is undefined at runtime
      vueTemplate: true,
      dts: ".noofpi/auto-imports.d.ts",
    }),
    Components({
      dirs: ["app/components"],
      directoryAsNamespace: true,
      resolvers: [
        (name) =>
          RUNTIME_COMPONENTS.includes(name)
            ? { name, from: "noofpi/runtime" }
            : undefined,
      ],
      dts: ".noofpi/components.d.ts",
    }),
  ];
}
