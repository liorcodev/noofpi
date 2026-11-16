import { useRoute } from "vue-router";

/**
 * Chooses the layout of the current page: a name from `app/layouts/` or `false` for none.
 * Call it in a page's `setup()` with a string literal. noofpi reads the literal at build time (the layout must be
 * known before the page renders, also on the server), so a variable or expression is not supported.
 */
export function useLayout(name: string | false): void {
  if (import.meta.env.DEV) {
    const route = useRoute();
    if (route.meta.layout !== name) {
      console.warn(
        `[noofpi] useLayout(${JSON.stringify(name)}) was not picked up for ${route.path}. ` +
          "Call it with a string literal (or false) inside a page in app/pages.",
      );
    }
  }
}
