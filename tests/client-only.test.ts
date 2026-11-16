import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { ClientOnly } from "../src/runtime/client-only";

const render = async (
  props: Record<string, unknown>,
  slots: Record<string, any>,
) =>
  (
    await renderToString(
      createSSRApp({ render: () => h(ClientOnly, props, slots) }),
    )
  ).replace(/<!--[[\]]-->/g, "");

describe("ClientOnly", () => {
  const content = { default: () => h("canvas") };

  it("does not render its slot on the server", async () => {
    expect(await render({}, content)).not.toContain("canvas");
  });

  it("renders the fallback slot, or the fallback text in fallbackTag", async () => {
    expect(
      await render({}, { ...content, fallback: () => h("i", "wait") }),
    ).toBe("<i>wait</i>");
    expect(await render({ fallback: "Loading" }, content)).toBe(
      "<span>Loading</span>",
    );
    expect(
      await render({ fallback: "Loading", fallbackTag: "p" }, content),
    ).toBe("<p>Loading</p>");
  });
});
