import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { resolveConfig } from "../src/config";
import { resolveImages, variantWidths, type ImageSource } from "../src/images";
import { NoofpiImage } from "../src/runtime/image";
import { processImage } from "../src/vite/images";

describe("images config", () => {
  it("applies defaults and normalizes widths", () => {
    expect(resolveConfig().images).toEqual({
      formats: ["avif", "webp"],
      widths: [640, 1024, 1920],
      quality: 75,
    });
    expect(
      resolveImages({ widths: [800, 400, 800], formats: ["webp"] }),
    ).toMatchObject({ widths: [400, 800], formats: ["webp"] });
  });

  it("rejects invalid options", () => {
    expect(() => resolveImages({ formats: ["gif" as "webp"] })).toThrow(
      "images.formats",
    );
    expect(() => resolveImages({ widths: [0] })).toThrow("images.widths");
    expect(() => resolveImages({ quality: 101 })).toThrow("images.quality");
  });

  it("never upscales", () => {
    expect(variantWidths(1000, [640, 1024, 1920])).toEqual([640, 1000]);
    expect(variantWidths(300, [640])).toEqual([300]);
  });
});

describe("processImage", () => {
  let file: string;
  beforeAll(async () => {
    file = path.join(
      mkdtempSync(path.join(tmpdir(), "noofpi-img-")),
      "A b.png",
    );
    const png = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: "#c33",
      },
    })
      .png()
      .toBuffer();
    writeFileSync(file, png);
  });

  const images = resolveImages({ widths: [50, 100, 400] });

  it("reads the size and lists variants without writing them", async () => {
    const { image, files } = await processImage(file, images, {
      base: "/",
      variants: true,
      emit: false,
    });
    expect(image).toMatchObject({ width: 200, height: 100 });
    expect(image.sources.map((source) => source.type)).toEqual([
      "image/avif",
      "image/webp",
    ]);
    expect(image.sources[0]!.srcset).toMatch(
      /^\/assets\/A-b-[0-9a-f]{8}-50w\.avif 50w, .*-100w\.avif 100w, .*-200w\.avif 200w$/,
    );
    expect(files).toEqual([]);
  });

  it("encodes the variants when emitting, and none in dev", async () => {
    const built = await processImage(file, images, {
      base: "/",
      variants: true,
      emit: true,
    });
    expect(built.files.map((f) => f.fileName)).toHaveLength(6);
    const first = built.files.find((f) => f.fileName.endsWith("-50w.webp"))!;
    expect((await sharp(first.data).metadata()).width).toBe(50);

    const dev = await processImage(file, images, {
      base: "/",
      variants: false,
      emit: false,
    });
    expect(dev.image.sources).toEqual([]);
  });
});

describe("NoofpiImage", () => {
  const render = async (props: Record<string, any>) =>
    (
      await renderToString(
        createSSRApp({ render: () => h(NoofpiImage, props as any) }),
      )
    ).replace(/<!--[[\]]-->/g, "");

  const source: ImageSource = {
    src: "/a.jpg",
    width: 800,
    height: 600,
    sources: [{ type: "image/avif", srcset: "/a-640w.avif 640w" }],
  };

  it("renders a picture with sources, size, and lazy loading", async () => {
    const html = await render({
      src: source,
      alt: "A",
      sizes: "50vw",
      class: "x",
    });
    expect(html).toContain(
      '<source type="image/avif" srcset="/a-640w.avif 640w" sizes="50vw">',
    );
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="x"');
  });

  it("supports priority and plain URLs", async () => {
    const html = await render({ src: source, priority: true });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
    expect(await render({ src: "/b.png", width: 10, height: 20 })).toBe(
      '<img src="/b.png" alt width="10" height="20" loading="lazy" decoding="async">',
    );
  });
});
