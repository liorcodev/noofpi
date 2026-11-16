import { FETCH_MODES, type FetchMode } from "./fetch-mode";
import { applyRouteSecurity, type RouteSecurityConfig } from "./security";

/** Options that apply to every page whose URL matches a `routeRules` pattern */
export interface RouteRule {
  /** `false` serves the client-only shell for matching pages, even when `ssr` is on globally */
  ssr?: boolean;
  /**
   * How the doofpi client reaches the API on matching pages, instead of `doofpi.fetch`, e.g. `"sfetch"` to keep the
   * API out of the browser for `/admin/**`. Needs `doofpi.url` unless it is `lfetch`; `sfetch` needs SSR.
   * `useDoofpi()` picks it from the page it is called on, so call it in that page's `setup()`.
   */
  fetch?: FetchMode;
  /**
   * Overrides the global `security` options for matching URL paths (pages, and the API / proxy for `csrf`).
   * Server-only: never sent to the browser.
   */
  security?: RouteSecurityConfig;
}

/**
 * Keyed by URL path pattern: `/about` (exact), `/users/*` (one segment) or `/admin/**` (the path itself and
 * everything below it). When several patterns match, the most specific one (the longest) wins per option.
 */
export type RouteRules = Record<string, RouteRule>;

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) =>
      segment === "**"
        ? ".*"
        : segment
            .split("*")
            .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
    )
    .join("/")
    // `/admin/**` also matches `/admin`
    .replace(/\/\.\*$/, "(?:/.*)?");
  // vue-router matches paths case-insensitively, so the rules must too or `/ADMIN` would skip the `/admin/**` ones
  return new RegExp(`^${source}/?$`, "i");
}

export function validateRouteRules(rules: RouteRules, ssr: boolean): void {
  for (const [pattern, rule] of Object.entries(rules)) {
    if (!pattern.startsWith("/"))
      throw new Error(
        `[noofpi] routeRules patterns must start with "/" (got "${pattern}")`,
      );
    if (rule.ssr !== undefined && typeof rule.ssr !== "boolean")
      throw new Error(
        `[noofpi] routeRules["${pattern}"].ssr must be a boolean`,
      );
    if (rule.ssr === true && !ssr)
      throw new Error(
        `[noofpi] routeRules["${pattern}"].ssr: true needs ssr: true in the config (routeRules can only turn SSR off)`,
      );
    if (rule.fetch !== undefined) {
      if (!FETCH_MODES.includes(rule.fetch))
        throw new Error(
          `[noofpi] routeRules["${pattern}"].fetch must be one of ${FETCH_MODES.join(", ")} (got "${String(rule.fetch)}")`,
        );
      if (rule.fetch === "sfetch" && (!ssr || rule.ssr === false))
        throw new Error(
          `[noofpi] routeRules["${pattern}"].fetch "sfetch" only fetches on the server, so the route must be server-rendered`,
        );
    }
    if (rule.security !== undefined) {
      if (typeof rule.security !== "object" || rule.security === null)
        throw new Error(
          `[noofpi] routeRules["${pattern}"].security must be an object`,
        );
      try {
        applyRouteSecurity(undefined, rule.security);
      } catch (error) {
        throw new Error(
          `[noofpi] routeRules["${pattern}"]: ${(error as Error).message.replace("[noofpi] ", "")}`,
        );
      }
    }
  }
}

/** The merged rule for a URL path (`/users/42`) */
export function matchRouteRules(
  rules: RouteRules,
  pathname: string,
): RouteRule {
  const merged: RouteRule = {};
  Object.keys(rules)
    .filter((pattern) => patternToRegExp(pattern).test(pathname))
    .sort((a, b) => a.length - b.length)
    .forEach((pattern) => {
      const { security, ...rest } = rules[pattern]!;
      Object.assign(merged, rest);
      // Security options are merged one by one, so a specific rule can change `csrf` and keep the broader rule's `csp`
      if (security) merged.security = { ...merged.security, ...security };
    });
  return merged;
}

/** The routeRules without their server-only options, safe to send to the browser */
export function toPublicRouteRules(rules: RouteRules): RouteRules {
  return Object.fromEntries(
    Object.entries(rules).map(([pattern, { security: _security, ...rule }]) => [
      pattern,
      rule,
    ]),
  );
}

/** The doofpi fetch mode of a URL path: the matching `routeRules` one, else the global default */
export function resolveFetchMode(
  defaultMode: FetchMode,
  rules: RouteRules | undefined,
  pathname: string,
): FetchMode {
  return (rules && matchRouteRules(rules, pathname).fetch) || defaultMode;
}

/** Whether `mode` is the default or set by any rule (e.g. whether the pfetch proxy is needed at all) */
export function usesFetchMode(
  defaultMode: FetchMode,
  rules: RouteRules | undefined,
  mode: FetchMode,
): boolean {
  return (
    defaultMode === mode ||
    Object.values(rules ?? {}).some((rule) => rule.fetch === mode)
  );
}

/** Whether the server renders this path (`false`: client-only shell) */
export function isServerRendered(
  ssr: boolean,
  rules: RouteRules | undefined,
  pathname: string,
): boolean {
  return ssr && (!rules || matchRouteRules(rules, pathname).ssr !== false);
}
