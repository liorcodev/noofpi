import { defineComponent, h, type Component } from "vue";
import { RouterView, useRoute } from "vue-router";
import { normalizeLayout } from "./routes";

/**
 * Renders the current page inside its layout: `route.meta.layout` (set with `useLayout()`), else the `default`
 * layout, else just the page. `useLayout(false)` means no layout. A default slot replaces the page.
 */
export function createLayoutComponent(layouts: Record<string, Component>) {
  return defineComponent({
    name: "NoofpiLayout",
    setup(_, { slots }) {
      const route = useRoute();
      return () => {
        const content = slots.default ? slots.default() : h(RouterView);
        const name = normalizeLayout(route.meta.layout);
        if (name === false) return content;
        const layout = layouts[name ?? "default"];
        if (!layout) {
          if (name)
            console.warn(
              `[noofpi] Unknown layout "${name}" (expected app/layouts/${name}.vue)`,
            );
          return content;
        }
        return h(layout, null, { default: () => content });
      };
    },
  });
}
