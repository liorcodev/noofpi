import { describe, expect, it } from "vitest";
import {
  describePayload,
  describeRequest,
  inspectRoute,
  listRoutes,
} from "../src/runtime/devtools";

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

describe("listRoutes", () => {
  it("reports every route sorted by path, resolved through the route rules", () => {
    const routes = listRoutes(
      [
        { path: "/users/:id", meta: { middleware: ["auth"] } },
        { path: "/admin", meta: {} },
        { path: "/", meta: { layout: false } },
      ] as any,
      config,
      files,
    );
    expect(routes.map((r) => r.path)).toEqual(["/", "/admin", "/users/:id"]);
    expect(routes[0]).toMatchObject({ layout: "none", rendering: "server" });
    expect(routes[1]).toMatchObject({ fetch: "pfetch", rendering: "client" });
    expect(routes[2]!.middleware.filter((m) => m.scope === "named")).toEqual([
      { name: "auth", scope: "named", missing: false },
    ]);
  });
});

describe("describePayload", () => {
  it("sizes each entry and lists the largest first", () => {
    const report = describePayload({
      data: { small: 1, big: { list: [1, 2, 3, 4, 5] } },
      errors: { failed: { message: "no" } },
      state: { count: 2 },
      locale: "fr",
    });
    expect(report.data.map((e) => e.key)).toEqual(["big", "small"]);
    expect(report.data[1]).toMatchObject({ json: "1", bytes: 1 });
    expect(report.locale).toBe("fr");
    expect(report.error).toBeUndefined();
    expect(report.bytes).toBe(
      [...report.data, ...report.errors, ...report.state].reduce(
        (sum, e) => sum + e.bytes,
        0,
      ),
    );
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
