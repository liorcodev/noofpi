import layouts from "virtual:noofpi/layouts";
import { RouterLink, RouterView } from "vue-router";
import { createLayoutComponent } from "./layout-component";

/** Renders the current page inside its layout. Use it in `app/app.vue`; give it a slot to place the page yourself */
export const NoofpiLayout = createLayoutComponent(layouts);

/** Renders the current route's page (like `<RouterView />`), for placing it inside your own markup */
export const NoofpiPage = RouterView;

/** Client-side navigation link (like `<RouterLink>`) */
export const NoofpiLink = RouterLink;
