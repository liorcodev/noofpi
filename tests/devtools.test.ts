import { describe, expect, it } from "vitest";
import { describeRequest, inspectRoute } from "../src/runtime/devtools";

const files = [
  "/app/middleware/auth.ts",
  "/app/middleware/log.global.ts",
  "/app/middleware/audit.global.ts",
];
const config = {
  ssr: true,
  routeRules: { "/admin/**": { fetch: "pfetch", ssr: false } },
  doofpi: { fetch: "lfetch" },
} as const;

const route = (path: string, meta: Record<string, unknown> = {}) =>
  ({ path, matched: [{ path: "/admin/:id" }], meta }) as any;

describe("inspectRoute", () => {
  it("lists global middleware in file order, then the page's named middleware", () => {
    const report = inspectRoute(
      route("/admin/1", { middleware: ["auth", "nope"] }),
      config,
      files,
    );
    expect(report.middleware).toEqual([
      { name: "audit", scope: "global", missing: false },
      { name: "log", scope: "global", missing: false },
      { name: "auth", scope: "named", missing: false },
      { name: "nope", scope: "named", missing: true },
    ]);
  });

  it("resolves layout, fetch mode and rendering through the route rules", () => {
    expect(inspectRoute(route("/admin/1"), config, files)).toMatchObject({
      pattern: "/admin/:id",
      layout: "default",
      fetch: "pfetch",
      rendering: "client",
    });
    expect(
      inspectRoute(route("/about", { layout: false }), config, files),
    ).toMatchObject({ layout: "none", fetch: "lfetch", rendering: "server" });
  });
});

describe("describeRequest", () => {
  it("strips the page origin and summarizes mode, transport, status and timing", () => {
    expect(
      describeRequest(
        {
          side: "server",
          mode: "lfetch",
          transport: "in-process",
          method: "GET",
          url: "http://app.test/doofpi.hello",
          status: 200,
          ms: 4,
        },
        "http://app.test",
      ),
    ).toEqual({
      request: "GET /doofpi.hello",
      detail: "server \u00b7 lfetch \u00b7 in-process \u00b7 200 \u00b7 4ms",
    });
    expect(
      describeRequest(
        {
          side: "browser",
          mode: "dfetch",
          transport: "http",
          method: "POST",
          url: "https://api.example.com/doofpi.hello",
          error: "boom",
        },
        "http://app.test",
      ).detail,
    ).toBe("browser \u00b7 dfetch \u00b7 http \u00b7 failed: boom");
  });
});
