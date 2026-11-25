import { describe, expect, it } from "vitest";
import {
  DEV_ERRORS_ELEMENT_ID,
  devErrorPage,
  parseDevErrors,
  serializeDevErrors,
  toDevError,
} from "../src/dev-errors";
import { withDevErrors } from "../src/vite/dev-errors";

describe("toDevError", () => {
  it("keeps name, message and stack of an Error", () => {
    const error = new TypeError("boom");
    expect(toDevError(error, "vue", "setup function")).toMatchObject({
      source: "vue",
      name: "TypeError",
      message: "boom",
      info: "setup function",
      stack: error.stack,
    });
  });

  it("describes anything else thrown", () => {
    expect(toDevError("oops", "promise")).toEqual({
      source: "promise",
      name: "Error",
      message: "oops",
    });
  });
});

describe("dev errors transport", () => {
  it("escapes markup so a message cannot break out of the script tag", () => {
    const html = serializeDevErrors([
      toDevError(new Error("</script><b>x"), "server"),
    ]);
    expect(html).toContain(DEV_ERRORS_ELEMENT_ID);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const json = />(.*)<\/script>$/s.exec(html)![1]!;
    expect(parseDevErrors(json)[0]).toMatchObject({
      source: "server",
      message: "</script><b>x",
    });
  });

  it("ignores malformed data", () => {
    expect(parseDevErrors("not json")).toEqual([]);
    expect(
      parseDevErrors('[1, {"message": 2}, {"message": "ok"}]'),
    ).toHaveLength(1);
  });
});

describe("withDevErrors", () => {
  const errors = [toDevError(new Error("<broken>"), "server")];

  it("leaves a request without errors alone", async () => {
    const response = new Response("x", { status: 500 });
    expect(await withDevErrors(response, [])).toBe(response);
  });

  it("embeds the errors in an HTML response", async () => {
    const response = await withDevErrors(
      new Response("<html><body>page</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      errors,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`id="${DEV_ERRORS_ELEMENT_ID}"`);
    expect(html.indexOf("page")).toBeLessThan(
      html.indexOf(DEV_ERRORS_ELEMENT_ID),
    );
  });

  it("turns a bare 500 into a page that shows the error, escaped", async () => {
    const response = await withDevErrors(
      new Response("Internal Server Error", { status: 500 }),
      errors,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("&lt;broken&gt;");
    expect(html).not.toContain("<broken>");
    expect(devErrorPage(errors)).toBe(html);
  });
});
