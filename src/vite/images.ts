import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import {
  variantWidths,
  type ImageSource,
  type ResolvedImages,
} from "../images";
import { importOptional } from "../optional";

const IMAGE_QUERY = /^(.+\.(?:jpe?g|png|webp|avif))\?image$/i;

export interface ProcessedImage {
  image: Omit<ImageSource, "src">;
  /** Encoded files to write to the output (only when `emit` is set) */
  files: { fileName: string; data: Buffer }[];
}

/**
 * Reads the size of an image and plans its `<source>` variants.
 * `variants: false` (dev) lists none; `emit: true` (client build) also encodes them. File names depend only on
 * the image content and the options, so the server build lists the same URLs without writing anything.
 */
export async function processImage(
  file: string,
  images: ResolvedImages,
  options: { base: string; variants: boolean; emit: boolean },
): Promise<ProcessedImage> {
  const { default: sharp } = await importOptional(
    () => import("sharp"),
    ["sharp"],
    "Importing an image with `?image`",
  );
  const input = await readFile(file);
  const metadata = await sharp(input).metadata();
  // EXIF orientations 5-8 are rotated by a quarter turn
  const turned = (metadata.orientation ?? 1) >= 5;
  const width = turned ? metadata.height : metadata.width;
  const height = turned ? metadata.width : metadata.height;
  if (!width || !height)
    throw new Error(`[noofpi] could not read the size of ${file}`);

  const image: ProcessedImage["image"] = { width, height, sources: [] };
  const files: ProcessedImage["files"] = [];
  if (!options.variants) return { image, files };

  const hash = createHash("sha256")
    .update(input)
    .update(JSON.stringify(images))
    .digest("hex")
    .slice(0, 8);
  const name = path
    .basename(file, path.extname(file))
    .replace(/[^\w.-]+/g, "-");
  const widths = variantWidths(width, images.widths);

  for (const format of images.formats) {
    const srcset: string[] = [];
    for (const target of widths) {
      const fileName = `assets/${name}-${hash}-${target}w.${format}`;
      srcset.push(`${options.base}${fileName} ${target}w`);
      if (!options.emit) continue;
      const resized = sharp(input)
        .rotate()
        .resize({ width: target, withoutEnlargement: true });
      const data = await (
        format === "avif"
          ? resized.avif({ quality: images.quality })
          : resized.webp({ quality: images.quality })
      ).toBuffer();
      files.push({ fileName, data });
    }
    image.sources.push({ type: `image/${format}`, srcset: srcset.join(", ") });
  }
  return { image, files };
}

/** `import hero from "./hero.jpg?image"` gives the `ImageSource` for `<NoofpiImage>`, with AVIF / WebP variants in builds */
export function imagesPlugin(images: ResolvedImages): Plugin {
  let base = "/";
  let build = false;

  return {
    name: "noofpi:images",
    enforce: "pre",
    configResolved(config) {
      build = config.command === "build";
      base = config.base.startsWith("/")
        ? config.base.replace(/\/?$/, "/")
        : "/";
    },
    async load(id) {
      const match = IMAGE_QUERY.exec(id);
      if (!match) return;
      const file = match[1]!;
      this.addWatchFile(file);
      const { image, files } = await processImage(file, images, {
        base,
        variants: build,
        emit: build && this.environment?.config.consumer === "client",
      });
      for (const { fileName, data } of files)
        this.emitFile({ type: "asset", fileName, source: data });
      return [
        `import src from ${JSON.stringify(file + "?url")};`,
        `export default { ...${JSON.stringify(image)}, src };`,
      ].join("\n");
    },
  };
}
