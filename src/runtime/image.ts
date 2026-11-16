import { defineComponent, h, mergeProps, type PropType, type VNode } from "vue";
import type { ImageSource } from "../images";

/**
 * Responsive image. Give it an `import hero from "./hero.jpg?image"` to get `width` / `height` (no layout shift) and
 * AVIF / WebP `<source>`s. A plain URL string renders an `<img>` (pass `width` and `height` yourself).
 * Images load lazily unless `priority` is set (above-the-fold images). Attributes such as `class` go on the `<img>`.
 */
export const NoofpiImage = defineComponent({
  name: "NoofpiImage",
  inheritAttrs: false,
  props: {
    src: {
      type: [String, Object] as PropType<string | ImageSource>,
      required: true,
    },
    alt: { type: String, default: "" },
    width: { type: [Number, String], default: undefined },
    height: { type: [Number, String], default: undefined },
    /** `sizes` of the generated `<source>`s, e.g. `(min-width: 768px) 50vw, 100vw` */
    sizes: { type: String, default: undefined },
    /** Load right away with high priority instead of lazily */
    priority: { type: Boolean, default: false },
  },
  setup(props, { attrs }) {
    return () => {
      const image = typeof props.src === "string" ? undefined : props.src;
      const img = h(
        "img",
        mergeProps(attrs, {
          src: image ? image.src : (props.src as string),
          alt: props.alt,
          width: props.width ?? image?.width,
          height: props.height ?? image?.height,
          loading: props.priority ? "eager" : "lazy",
          fetchpriority: props.priority ? "high" : undefined,
          decoding: "async",
        }),
      );
      if (!image?.sources.length) return img;
      const sources: VNode[] = image.sources.map((source) =>
        h("source", {
          type: source.type,
          srcset: source.srcset,
          sizes: props.sizes,
        }),
      );
      return h("picture", [...sources, img]);
    };
  },
});
