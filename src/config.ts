import type { UserConfig as ViteUserConfig } from "vite";
import {
  assertBuildPreset,
  BUILD_PRESETS,
  type BuildPreset,
} from "./build-preset";
import { FETCH_MODES, type FetchMode } from "./fetch-mode";
import { normalizeFonts } from "./fonts/normalize";
import type { FontsConfig, ResolvedFontFamily } from "./fonts/types";
import type { HeadConfig } from "./head";
import { resolveI18n, type I18nConfig, type ResolvedI18n } from "./i18n";
import {
  resolveImages,
  type ImagesConfig,
  type ResolvedImages,
} from "./images";
import {
  toPublicRouteRules,
  usesFetchMode,
  validateRouteRules,
  type RouteRules,
} from "./route-rules";
import {
  resolveSecurity,
  type ResolvedSecurity,
  type SecurityConfig,
} from "./security";
import type { ServerConfig } from "./server/types";

export { FETCH_MODES, BUILD_PRESETS };
export type { FetchMode, BuildPreset };

export interface NoofpiConfig {
  /** Render pages on the server (`true`, default) or ship a client-only SPA (`false`) */
  ssr?: boolean;
  /** Per-route overrides keyed by URL pattern (`/admin/**`, `/users/*`, `/about`), e.g. `{ "/admin/**": { ssr: false, fetch: "pfetch" } }` */
  routeRules?: RouteRules;
  /** Default `<head>` of every page: `title` (put `%s` where a page's `useHead({ title })` goes), `meta`, `link`, `htmlAttrs`, `bodyAttrs` */
  head?: HeadConfig;
  /** Enable the built-in Tailwind CSS (v4) vite plugin */
  tailwind?: boolean;
  /** Nuxt-style auto-imports for Vue, vue-router, noofpi composables, `app/composables`, `app/utils` and `app/components` (default: `true`) */
  autoImports?: boolean;
  /** CSS files (relative to the project root). Defaults to `app/assets/main.css` when it exists */
  css?: string[];
  /** Built-in fonts: Google fonts (self-hosted) and local font files, usable from CSS and Tailwind */
  fonts?: FontsConfig;
  /** Image pipeline of `import img from "./img.jpg?image"` (used by `<NoofpiImage>`): AVIF / WebP variants at several widths */
  images?: ImagesConfig;
  /** Built-in security: `csp` (with automatic nonces), security response `headers`, `csrf` protection of the API, request `bodyLimit` and `allowedHosts` */
  security?: SecurityConfig;
  /** Built-in i18n: `t()` with typed message keys from `app/locales/<locale>.ts`, locale detection (cookie, `Accept-Language`) and `<html lang dir>`. Off unless set */
  i18n?: I18nConfig;
  doofpi?: {
    /** How the doofpi client reaches the API. Default: `lfetch`. `routeRules[...].fetch` overrides it per route */
    fetch?: FetchMode;
    /** Remote doofpi API origin. Required when `dfetch`, `pfetch` or `sfetch` is used (here or in `routeRules`) */
    url?: string;
    /** doofpi root path of the API. Default: `/doofpi` */
    root?: string;
  };
  devServer?: {
    port?: number;
    host?: string;
  };
  build?: {
    /** Deploy target of `noofpi build`: `node` (default), `bun`, `docker`, `cloudflare-worker`, `cloudflare-pages` or `github-pages` (static SPA). `--preset` overrides it */
    preset?: BuildPreset;
  };
  /** Mini devtools overlay in `noofpi dev` (current route, middleware chain, fetch mode, doofpi requests, CSP violations). Never included in production builds. Default: `true` */
  devtools?: boolean;
  /** Extra vite options, merged into the generated config */
  vite?: ViteUserConfig;
}

export interface ResolvedNoofpiConfig {
  ssr: boolean;
  routeRules: RouteRules;
  head: HeadConfig;
  tailwind: boolean;
  autoImports: boolean;
  css: string[] | undefined;
  fonts: ResolvedFontFamily[];
  images: ResolvedImages;
  security: ResolvedSecurity;
  i18n: ResolvedI18n | undefined;
  doofpi: { fetch: FetchMode; url: string | undefined; root: string };
  devServer: { port: number; host: string };
  build: { preset: BuildPreset };
  devtools: boolean;
  vite: ViteUserConfig;
}

/** Config exposed to browser code (never contains `doofpi.url` unless the browser needs it) */
export interface PublicNoofpiConfig {
  ssr: boolean;
  routeRules: RouteRules;
  head: HeadConfig;
  doofpi: { fetch: FetchMode; url: string | undefined; root: string };
  devtools: boolean;
}

export function defineNoofpiConfig(config: NoofpiConfig): NoofpiConfig {
  return config;
}

export function resolveConfig(input: NoofpiConfig = {}): ResolvedNoofpiConfig {
  const mode = input.doofpi?.fetch ?? "lfetch";
  if (!FETCH_MODES.includes(mode)) {
    throw new Error(
      `[noofpi] doofpi.fetch must be one of ${FETCH_MODES.join(", ")} (got "${String(mode)}")`,
    );
  }

  const ssr = input.ssr ?? true;
  if (mode === "sfetch" && !ssr) {
    throw new Error(
      '[noofpi] doofpi.fetch "sfetch" only fetches on the server, so it requires ssr: true',
    );
  }

  const routeRules = input.routeRules ?? {};
  validateRouteRules(routeRules, ssr);

  let url = input.doofpi?.url;
  const remoteRule = Object.entries(routeRules).find(
    ([, rule]) => rule.fetch !== undefined && rule.fetch !== "lfetch",
  );
  if (mode !== "lfetch" || remoteRule) {
    if (!url)
      throw new Error(
        mode !== "lfetch"
          ? `[noofpi] doofpi.url is required when doofpi.fetch is "${mode}"`
          : `[noofpi] doofpi.url is required when routeRules["${remoteRule![0]}"].fetch is "${remoteRule![1].fetch}"`,
      );
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new Error();
      url = parsed.origin;
    } catch {
      throw new Error(
        `[noofpi] doofpi.url must be an absolute http(s) URL (got "${url}")`,
      );
    }
  }

  const root = input.doofpi?.root ?? "/doofpi";
  if (!root.startsWith("/") || root.length < 2 || root.endsWith("/")) {
    throw new Error(
      `[noofpi] doofpi.root must start with "/" and not end with "/" (got "${root}")`,
    );
  }

  const security = resolveSecurity(input.security);
  const preset = assertBuildPreset(
    input.build?.preset ?? "node",
    "build.preset",
  );

  return {
    ssr,
    routeRules,
    head: input.head ?? {},
    tailwind: input.tailwind ?? false,
    autoImports: input.autoImports ?? true,
    css: input.css,
    fonts: normalizeFonts(input.fonts?.families),
    images: resolveImages(input.images),
    security,
    i18n: resolveI18n(input.i18n),
    doofpi: { fetch: mode, url, root },
    devServer: {
      port: input.devServer?.port ?? 3000,
      host: input.devServer?.host ?? "localhost",
    },
    build: { preset },
    devtools: input.devtools ?? true,
    vite: input.vite ?? {},
  };
}

export function toPublicConfig(
  config: ResolvedNoofpiConfig,
): PublicNoofpiConfig {
  const { fetch, url, root } = config.doofpi;
  // Only direct fetching (as the default or for some route) needs the remote URL in the browser
  const direct = usesFetchMode(fetch, config.routeRules, "dfetch");
  return {
    ssr: config.ssr,
    routeRules: toPublicRouteRules(config.routeRules),
    head: config.head,
    doofpi: { fetch, url: direct ? url : undefined, root },
    devtools: config.devtools,
  };
}

/** Config of the generated server module (the only place besides dfetch where `doofpi.url` is available) */
export function toServerConfig(config: ResolvedNoofpiConfig): ServerConfig {
  const { ssr, doofpi, routeRules, head, security } = config;
  return { ssr, doofpi, routeRules, head, security };
}
