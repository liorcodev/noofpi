import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { applyHead, resolveHead } from "../src/head";
import { createHeadManager, HEAD_KEY, useHead } from "../src/runtime/head";

describe("resolveHead", () => {
  it("fills %s of the config title with the page title", () => {
    const config = { title: "hello %s" };
    expect(resolveHead(config, [{ title: "About" }]).title).toBe("hello About");
    // the last entry wins
    expect(
      resolveHead(config, [{ title: "Layout" }, { title: "Page" }]).title,
    ).toBe("hello Page");
  });

  it("uses a config title without %s only as the default", () => {
    expect(resolveHead({ title: "Site" }).title).toBe("Site");
    expect(resolveHead({ title: "Site" }, [{ title: "About" }]).title).toBe(
      "About",
    );
  });

  it("drops %s and dangling separators when the page has no title", () => {
    expect(resolveHead({ title: "hello %s" }).title).toBe("hello");
    expect(resolveHead({ title: "%s | My site" }).title).toBe("My site");
    expect(resolveHead().title).toBe("noofpi");
  });

  it("lets later meta and link tags replace earlier ones with the same identity", () => {
    const head = resolveHead(
      {
        meta: [
          { name: "description", content: "default" },
          { property: "og:type", content: "website" },
        ],
        link: [{ rel: "canonical", href: "/a" }],
      },
      [
        {
          meta: [
            { name: "description", content: "page" },
            { name: "robots", content: "noindex" },
          ],
          link: [{ rel: "canonical", href: "/b" }],
        },
      ],
    );
    expect(head.meta).toEqual([
      { name: "description", content: "page" },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
    ]);
    expect(head.link).toEqual([{ rel: "canonical", href: "/b" }]);
  });

  it("normalizes attribute values", () => {
    const head = resolveHead(undefined, [
      {
        htmlAttrs: { class: "dark", hidden: true, off: false, none: undefined },
        meta: [{ name: "n", content: 1 }],
      },
    ]);
    expect(head.htmlAttrs).toEqual({ lang: "en", class: "dark", hidden: "" });
    expect(head.meta).toEqual([{ name: "n", content: "1" }]);
  });
});

describe("applyHead", () => {
  const shell = `<!doctype html>
<html lang="en" class="a">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <title>noofpi</title>
  </head>
  <body></body>
</html>`;

  it("writes title, tags and attributes and escapes them", () => {
    const html = applyHead(
      shell,
      resolveHead({ title: "a $& <b>" }, [
        {
          meta: [{ name: "description", content: 'x"y' }],
          link: [{ rel: "icon", href: "/f.ico" }],
          htmlAttrs: { lang: "he", class: "b" },
          bodyAttrs: { class: "page" },
        },
      ]),
    );
    expect(html).toContain("<title>a $&amp; &lt;b&gt;</title>");
    expect(html).toContain(
      '<meta name="description" content="x&quot;y" data-noofpi-head="" />',
    );
    expect(html).toContain(
      '<link rel="icon" href="/f.ico" data-noofpi-head="" />',
    );
    expect(html).toContain(
      '<html lang="he" class="b" data-noofpi-attrs="lang class">',
    );
    expect(html).toContain('<body class="page" data-noofpi-attrs="class">');
  });

  it("replaces the shell's viewport and charset with page-level ones", () => {
    const html = applyHead(
      shell,
      resolveHead(undefined, [
        {
          meta: [
            { name: "viewport", content: "width=500" },
            { charset: "utf-16" },
          ],
        },
      ]),
    );
    expect(html.match(/name="viewport"/g)).toHaveLength(1);
    expect(html).toContain('content="width=500"');
    expect(html).not.toContain('charset="UTF-8"');
  });

  it("leaves the shell untouched when nothing differs", () => {
    expect(applyHead(shell, resolveHead())).toBe(shell);
  });
});

describe("useHead", () => {
  const renderPage = async (setup: () => void, defaults = {}) => {
    const head = createHeadManager(defaults);
    const app = createSSRApp(
      defineComponent({
        setup() {
          setup();
          return () => h("p");
        },
      }),
    );
    app.provide(HEAD_KEY, head);
    await renderToString(app);
    return head.resolve();
  };

  it("registers the page's head, accepting a getter", async () => {
    const name = ref("Ada");
    const head = await renderPage(
      () => useHead(() => ({ title: name.value })),
      { title: "hello %s" },
    );
    expect(head.title).toBe("hello Ada");
  });

  it("is reactive and removed with its scope", () => {
    const manager = createHeadManager({ title: "T: %s" });
    const title = ref("one");
    const remove = manager.add(() => ({ title: title.value }));
    expect(manager.resolve().title).toBe("T: one");
    title.value = "two";
    expect(manager.resolve().title).toBe("T: two");
    remove();
    expect(manager.resolve().title).toBe("T");
  });

  it("throws outside of an app", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => useHead({ title: "x" })).toThrow("inside setup()");
    warn.mockRestore();
  });
});
