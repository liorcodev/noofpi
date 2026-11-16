declare module "virtual:noofpi/config" {
  import type { HeadConfig, RouteRules } from "noofpi/runtime";
  interface DoofpiConfig {
    fetch: "dfetch" | "pfetch" | "lfetch" | "sfetch";
    url: string | undefined;
    root: string;
  }
  interface VirtualConfig {
    ssr: boolean;
    routeRules: RouteRules;
    head: HeadConfig;
    doofpi: DoofpiConfig;
    devtools: boolean;
  }
  export const publicConfig: VirtualConfig;
  /** Only defined in server builds */
  export const serverConfig: VirtualConfig | undefined;
}

declare module "virtual:noofpi/i18n" {
  import type { Messages } from "noofpi/runtime";
  /** `undefined` unless `i18n` is configured */
  export const i18nConfig:
    { locales: string[]; defaultLocale: string } | undefined;
  /** `app/locales/*`, keyed by file path. Server builds only (empty in the browser) */
  export const messageFiles: Record<string, Messages>;
  /** `app/locales/*`, keyed by file path, loaded on demand. Browser builds only (empty on the server) */
  export const messageLoaders: Record<string, () => Promise<Messages>>;
}

declare module "virtual:noofpi/routes" {
  import type { RouteRecordRaw } from "vue-router";
  const routes: RouteRecordRaw[];
  export default routes;
}

declare module "virtual:noofpi/layouts" {
  import type { Component } from "vue";
  const layouts: Record<string, Component>;
  export default layouts;
}

declare module "virtual:noofpi/middleware" {
  import type { RouteMiddleware } from "noofpi/runtime";
  const middleware: Record<string, RouteMiddleware>;
  export default middleware;
}

declare module "virtual:noofpi/plugins" {
  import type { NoofpiPlugin } from "noofpi/runtime";
  const plugins: Record<string, NoofpiPlugin>;
  export default plugins;
}

declare module "virtual:noofpi/app-root" {
  import type { Component } from "vue";
  const component: Component;
  export default component;
}

declare module "virtual:noofpi/error" {
  import type { Component } from "vue";
  /** `app/error.vue`, or `undefined` when the project has none */
  const component: Component | undefined;
  export default component;
}

declare module "*?image" {
  import type { ImageSource } from "noofpi/runtime";
  /** Size and AVIF / WebP variants of the image, for `<NoofpiImage>` */
  const image: ImageSource;
  export default image;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, any>;
  export default component;
}
