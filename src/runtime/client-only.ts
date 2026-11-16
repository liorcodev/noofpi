import { defineComponent, h, onMounted, ref } from "vue";

/**
 * Renders its default slot only in the browser, after the app has mounted. The server and the first client render
 * (so hydration matches) show the `fallback` slot, or `fallback` text in a `fallbackTag` element, or nothing.
 */
export const ClientOnly = defineComponent({
  name: "ClientOnly",
  props: {
    fallback: { type: String, default: undefined },
    fallbackTag: { type: String, default: "span" },
  },
  setup(props, { slots }) {
    const mounted = ref(false);
    onMounted(() => {
      mounted.value = true;
    });
    return () => {
      if (mounted.value) return slots.default?.();
      if (slots.fallback) return slots.fallback();
      return props.fallback === undefined
        ? null
        : h(props.fallbackTag, props.fallback);
    };
  },
});
