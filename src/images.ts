export const IMAGE_FORMATS = ["avif", "webp"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export interface ImagesConfig {
  /** Formats generated next to the original, best first. Default: `["avif", "webp"]` */
  formats?: ImageFormat[];
  /** Widths (px) generated for each format; widths larger than the image are skipped. Default: `[640, 1024, 1920]` */
  widths?: number[];
  /** Encoder quality of the generated files, 1-100. Default: 75 */
  quality?: number;
}

export interface ResolvedImages {
  formats: ImageFormat[];
  widths: number[];
  quality: number;
}

/** What `import hero from "./hero.jpg?image"` evaluates to; pass it to `<NoofpiImage :src="hero" />` */
export interface ImageSource {
  /** The original file */
  src: string;
  width: number;
  height: number;
  /** Generated `<source>` candidates (empty in dev, where only the original is served) */
  sources: { type: string; srcset: string }[];
}

export function resolveImages(input: ImagesConfig = {}): ResolvedImages {
  const formats = input.formats ?? [...IMAGE_FORMATS];
  for (const format of formats) {
    if (!IMAGE_FORMATS.includes(format))
      throw new Error(
        `[noofpi] images.formats must only contain ${IMAGE_FORMATS.join(", ")} (got "${String(format)}")`,
      );
  }
  const widths = input.widths ?? [640, 1024, 1920];
  if (widths.some((width) => !Number.isInteger(width) || width < 1))
    throw new Error("[noofpi] images.widths must be positive integers");
  const quality = input.quality ?? 75;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error("[noofpi] images.quality must be an integer from 1 to 100");
  return {
    formats: [...new Set(formats)],
    widths: [...new Set(widths)].sort((a, b) => a - b),
    quality,
  };
}

/** The configured widths smaller than the image, plus the image's own width (never upscales) */
export function variantWidths(imageWidth: number, widths: number[]): number[] {
  return [...widths.filter((width) => width < imageWidth), imageWidth];
}
