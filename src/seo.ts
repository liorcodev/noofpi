import { matchesRoutePattern } from "./route-rules";

export interface SeoConfig {
  /** Public URL of the site (`https://example.com`, or with a path for project sites). Needed for the sitemap, whose URLs are absolute */
  siteUrl?: string;
  /** Generate `sitemap.xml` from the static pages (those without params) at build time. Default: `true` when `siteUrl` is set, otherwise off. `false` disables it */
  sitemap?: boolean;
  /** Generate `robots.txt` at build time (pointing to the sitemap, if any). Default: `true`. `false` disables it */
  robots?: boolean;
  /** Page patterns (`/admin/**`, `/users/*`, `/about`, like `routeRules`) left out of the sitemap and disallowed in `robots.txt` */
  exclude?: string[];
}

export interface ResolvedSeo {
  siteUrl: string | undefined;
  sitemap: boolean;
  robots: boolean;
  exclude: string[];
}

export function resolveSeo(input: SeoConfig = {}): ResolvedSeo {
  let siteUrl: string | undefined;
  if (input.siteUrl !== undefined) {
    try {
      const parsed = new URL(input.siteUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new Error();
      siteUrl = (parsed.origin + parsed.pathname).replace(/\/+$/, "");
    } catch {
      throw new Error(
        `[noofpi] seo.siteUrl must be an absolute http(s) URL (got "${input.siteUrl}")`,
      );
    }
  }
  if (input.sitemap === true && !siteUrl)
    throw new Error(
      "[noofpi] seo.sitemap needs seo.siteUrl (sitemap URLs are absolute)",
    );
  const exclude = input.exclude ?? [];
  for (const pattern of exclude)
    if (typeof pattern !== "string" || !pattern.startsWith("/"))
      throw new Error(
        `[noofpi] seo.exclude patterns must start with "/" (got "${String(pattern)}")`,
      );
  return {
    siteUrl,
    sitemap: input.sitemap ?? siteUrl !== undefined,
    robots: input.robots ?? true,
    exclude,
  };
}

/** The pages a sitemap lists: routes without params, minus the excluded ones */
export function sitemapRoutes(routes: string[], exclude: string[]): string[] {
  return [...new Set(routes)]
    .filter(
      (route) =>
        !route.includes(":") &&
        !exclude.some((pattern) => matchesRoutePattern(pattern, route)),
    )
    .sort();
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function sitemapXml(siteUrl: string, routes: string[]): string {
  const urls = routes.map(
    (route) =>
      `  <url><loc>${escapeXml(siteUrl + (route === "/" ? "/" : route))}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function robotsTxt(seo: ResolvedSeo): string {
  const lines = ["User-agent: *"];
  if (!seo.exclude.length) lines.push("Allow: /");
  for (const pattern of seo.exclude) {
    // `/admin/**` blocks the page and everything below it, anything else is matched as a whole path
    if (pattern.endsWith("/**")) {
      const base = pattern.slice(0, -3);
      lines.push(`Disallow: ${base}/`);
      if (base) lines.push(`Disallow: ${base}$`);
    } else lines.push(`Disallow: ${pattern}$`);
  }
  if (seo.sitemap && seo.siteUrl)
    lines.push("", `Sitemap: ${seo.siteUrl}/sitemap.xml`);
  return lines.join("\n") + "\n";
}
