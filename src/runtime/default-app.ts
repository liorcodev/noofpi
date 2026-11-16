import { defineComponent, h } from "vue";
import { NoofpiLayout } from "./page";

/** Root component used when the project has no `app/app.vue` */
const DefaultApp = defineComponent({
  name: "NoofpiApp",
  render: () => h(NoofpiLayout),
});

export default DefaultApp;
