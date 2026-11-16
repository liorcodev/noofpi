import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";
import { fontThemePlugin, resolveFonts } from "../src/fonts";
import { googleCssUrl, parseGoogleCss } from "../src/fonts/providers/google";
import type { FontFamily } from "../src/fonts/types";

const fonts = (...families: FontFamily[]) =>
  resolveConfig({ fonts: { families } }).fonts;

describe("fonts config", () => {
  it("applies defaults", () => {
    expect(fonts({ provider: "google", name: "Open Sans" })[0]).toMatchObject({
      alias: "open-sans",
      weights: ["400"],
      styles: ["normal"],
      subsets: [],
      display: "swap",
      fallback: [],
    });
    expect(resolveConfig().fonts).toEqual([]);
  });

  it("normalizes weights and local files", () => {
    expect(
      fonts({
        provider: "local",
        name: "Mine",
        weight: "bold",
        src: [
          { src: "a.woff2" },
          { src: "b.woff2", weight: 300, style: "italic" },
        ],
      })[0]!.files,
    ).toEqual([
      { src: "a.woff2", weight: "700", style: "normal" },
      { src: "b.woff2", weight: "300", style: "italic" },
    ]);
  });

  it("rejects bad input", () => {
    const bad = (family: unknown, message: string) =>
      expect(() => fonts(family as FontFamily)).toThrow(message);
    bad({ provider: "adobe", name: "X" }, "provider must be one of");
    bad({ provider: "google", name: " " }, "name is required");
    bad({ provider: "google", name: "X", weight: "heavy" }, "invalid weight");
    bad({ provider: "google", name: "X", weight: "900 100" }, "invalid weight");
    bad({ provider: "local", name: "X" }, "src is required");
    bad(
      { provider: "local", name: "X", src: "a.woff2", weight: [400] },
      "single weight",
    );
    expect(() =>
      fonts(
        { provider: "google", name: "Inter" },
        { provider: "local", name: "inter", src: "a.woff2" },
      ),
    ).toThrow("already used");
  });
});

describe("google provider", () => {
  it("builds a sorted CSS2 API url", () => {
    const [family] = fonts({
      provider: "google",
      name: "Open Sans",
      weight: [700, 400],
      style: ["italic", "normal"],
    });
    expect(googleCssUrl(family!)).toBe(
      "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap",
    );
    const [variable] = fonts({
      provider: "google",
      name: "Inter",
      weight: "100 900",
    });
    expect(googleCssUrl(variable!)).toContain("Inter:wght@100..900");
  });

  it("parses font-face blocks with their subset", () => {
    const [latinExt, latin] = parseGoogleCss(`
/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/inter/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2');
}`);
    expect(latinExt).toMatchObject({
      subset: "latin-ext",
      weight: "100 900",
      unicodeRange: "U+0100-02BA",
    });
    expect(latin).toMatchObject({
      subset: "latin",
      style: "italic",
      sources: [
        {
          url: "https://fonts.gstatic.com/s/inter/latin.woff2",
          format: "woff2",
        },
      ],
    });
  });
});

describe("resolveFonts", () => {
  const project = () => mkdtempSync(path.join(tmpdir(), "noofpi-fonts-"));

  it("does nothing without fonts", async () => {
    expect(await resolveFonts(project(), resolveConfig())).toEqual({
      cssFile: undefined,
      theme: "",
    });
  });

  it("downloads google fonts once and writes @font-face + the Tailwind theme", async () => {
    const root = project();
    const requests: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      return new Response(
        url.includes("googleapis")
          ? `/* latin */\n@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/inter.woff2) format('woff2'); unicode-range: U+0000-00FF; }\n/* cyrillic */\n@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/cyr.woff2) format('woff2'); }`
          : "font-bytes",
      );
    }) as typeof fetch;
    const config = resolveConfig({
      tailwind: true,
      fonts: {
        families: [
          {
            provider: "google",
            name: "Inter",
            alias: "sans",
            fallback: ["ui-sans-serif", "sans-serif"],
          },
        ],
      },
    });

    const assets = await resolveFonts(root, config, fakeFetch);
    const css = readFileSync(assets.cssFile!, "utf-8");
    expect(css).toContain('font-family: "Inter"');
    expect(css).toMatch(
      /url\("\.\/fonts\/[0-9a-f]{16}\.woff2"\) format\("woff2"\)/,
    );
    expect(css).toContain("unicode-range: U+0000-00FF");
    // Every subset is kept by default
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(assets.theme).toBe(
      '@theme {\n  --font-sans: "Inter", ui-sans-serif, sans-serif;\n}\n',
    );

    await resolveFonts(root, config, fakeFetch);
    expect(requests).toHaveLength(3);

    const latinOnly = resolveConfig({
      fonts: {
        families: [{ provider: "google", name: "Inter", subsets: ["latin"] }],
      },
    });
    const filtered = await resolveFonts(root, latinOnly, fakeFetch);
    expect(
      readFileSync(filtered.cssFile!, "utf-8").match(/@font-face/g),
    ).toHaveLength(1);
  });

  it("shares one download between faces that use the same file", async () => {
    const requests: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const face = (subset: string) =>
        `/* ${subset} */\n@font-face { font-family: 'M'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/m.woff2) format('woff2'); }`;
      return new Response(
        url.includes("googleapis")
          ? `${face("latin")}\n${face("latin-ext")}`
          : "font-bytes",
      );
    }) as typeof fetch;
    await resolveFonts(
      project(),
      resolveConfig({
        fonts: { families: [{ provider: "google", name: "M" }] },
      }),
      fakeFetch,
    );
    expect(requests).toHaveLength(2);
  });

  it("references local files and exposes :root variables without Tailwind", async () => {
    const root = project();
    mkdirSync(path.join(root, "app/fonts"), { recursive: true });
    writeFileSync(path.join(root, "app/fonts/Mine.woff2"), "x");
    const assets = await resolveFonts(
      root,
      resolveConfig({
        fonts: {
          families: [
            {
              provider: "local",
              name: "Mine",
              src: "/app/fonts/Mine.woff2",
              weight: 600,
            },
          ],
        },
      }),
    );
    const css = readFileSync(assets.cssFile!, "utf-8");
    expect(css).toContain(
      'src: url("../app/fonts/Mine.woff2") format("woff2")',
    );
    expect(css).toContain("font-weight: 600");
    expect(css).toContain(':root {\n  --font-mine: "Mine";');
    expect(assets.theme).toBe("");

    await expect(
      resolveFonts(
        root,
        resolveConfig({
          fonts: {
            families: [{ provider: "local", name: "X", src: "nope.woff2" }],
          },
        }),
      ),
    ).rejects.toThrow("file not found");
  });
});

describe("fontThemePlugin", () => {
  const transform = (code: string, id: string) =>
    (fontThemePlugin("@theme {}\n").transform as any)(code, id);

  it("only touches stylesheets that import Tailwind", () => {
    expect(transform('@import "tailwindcss";', "/a/main.css?direct").code).toBe(
      '@import "tailwindcss";\n@theme {}\n',
    );
    expect(transform("@import 'tailwindcss/theme';", "/a.css").code).toContain(
      "@theme {}",
    );
    expect(transform("body{}", "/a.css")).toBeUndefined();
    expect(transform('@import "tailwindcss";', "/a.ts")).toBeUndefined();
  });
});
