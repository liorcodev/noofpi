import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";
import { resolveSeo, robotsTxt, sitemapRoutes, sitemapXml } from "../src/seo";
import { writeSeoFiles } from "../src/vite/presets";

describe("resolveSeo", () => {
  it("generates robots.txt only, by default", () => {
    expect(resolveSeo()).toMatchObject({ sitemap: false, robots: true });
  });

  it("enables the sitemap with siteUrl and lets both be disabled", () => {
    expect(resolveSeo({ siteUrl: "https://a.io/" })).toMatchObject({
      siteUrl: "https://a.io",
      sitemap: true,
    });
    expect(
      resolveSeo({ siteUrl: "https://a.io", sitemap: false, robots: false }),
    ).toMatchObject({ sitemap: false, robots: false });
  });

  it("validates its options", () => {
    expect(() => resolveSeo({ siteUrl: "a.io" })).toThrow("absolute http(s)");
    expect(() => resolveSeo({ sitemap: true })).toThrow("seo.siteUrl");
    expect(() => resolveSeo({ exclude: ["admin"] })).toThrow('start with "/"');
    expect(resolveConfig({ seo: { robots: false } }).seo.robots).toBe(false);
  });
});

describe("sitemap and robots", () => {
  it("lists static, non-excluded pages only", () => {
    const routes = [
      "/",
      "/about",
      "/users/:id",
      "/docs/:slug(.*)*",
      "/admin",
      "/admin/users",
    ];
    expect(sitemapRoutes(routes, ["/admin/**"])).toEqual(["/", "/about"]);
    expect(sitemapXml("https://a.io/x", ["/", "/a&b"])).toContain(
      "<loc>https://a.io/x/</loc>",
    );
    expect(sitemapXml("https://a.io", ["/a&b"])).toContain(
      "<loc>https://a.io/a&amp;b</loc>",
    );
  });

  it("writes robots.txt with disallowed patterns and the sitemap", () => {
    expect(robotsTxt(resolveSeo())).toBe("User-agent: *\nAllow: /\n");
    expect(
      robotsTxt(
        resolveSeo({ siteUrl: "https://a.io", exclude: ["/admin/**", "/x"] }),
      ),
    ).toBe(
      "User-agent: *\nDisallow: /admin/\nDisallow: /admin$\nDisallow: /x$\n\nSitemap: https://a.io/sitemap.xml\n",
    );
  });
});

describe("writeSeoFiles", () => {
  function project() {
    const root = mkdtempSync(path.join(tmpdir(), "noofpi-seo-"));
    mkdirSync(path.join(root, "app/pages"), { recursive: true });
    mkdirSync(path.join(root, ".output/public"), { recursive: true });
    writeFileSync(path.join(root, "app/pages/index.vue"), "");
    writeFileSync(path.join(root, "app/pages/about.vue"), "");
    return root;
  }
  const out = (root: string, name: string) =>
    path.join(root, ".output/public", name);

  it("writes both files from the pages", async () => {
    const root = project();
    await writeSeoFiles(
      root,
      resolveConfig({ seo: { siteUrl: "https://a.io" } }),
    );
    expect(readFileSync(out(root, "sitemap.xml"), "utf8")).toContain(
      "<loc>https://a.io/about</loc>",
    );
    expect(readFileSync(out(root, "robots.txt"), "utf8")).toContain("Sitemap:");
  });

  it("writes nothing when disabled and keeps files from public/", async () => {
    const root = project();
    await writeSeoFiles(
      root,
      resolveConfig({
        seo: { siteUrl: "https://a.io", sitemap: false, robots: false },
      }),
    );
    expect(existsSync(out(root, "sitemap.xml"))).toBe(false);
    expect(existsSync(out(root, "robots.txt"))).toBe(false);

    writeFileSync(out(root, "robots.txt"), "mine");
    await writeSeoFiles(root, resolveConfig());
    expect(readFileSync(out(root, "robots.txt"), "utf8")).toBe("mine");
  });
});
