import { describe, expect, it } from "vitest";
import {
  isServerRendered,
  matchRouteRules,
  resolveFetchMode,
  toPublicRouteRules,
  usesFetchMode,
  validateRouteRules,
} from "../src/route-rules";

describe("matchRouteRules", () => {
  const rules = {
    "/about": { ssr: false },
    "/admin/**": { ssr: false },
    "/shop/*": { ssr: false },
    "/admin/public/**": { ssr: true },
  };
  const ssrOf = (path: string) => matchRouteRules(rules, path).ssr;

  it("matches exact paths, with or without a trailing slash", () => {
    expect(ssrOf("/about")).toBe(false);
    expect(ssrOf("/about/")).toBe(false);
    expect(ssrOf("/about/team")).toBeUndefined();
  });

  it("matches ** at any depth, including the path itself", () => {
    expect(ssrOf("/admin")).toBe(false);
    expect(ssrOf("/admin/users/1")).toBe(false);
    expect(ssrOf("/administrator")).toBeUndefined();
  });

  it("matches * for exactly one segment", () => {
    expect(ssrOf("/shop/shoes")).toBe(false);
    expect(ssrOf("/shop/shoes/red")).toBeUndefined();
    expect(ssrOf("/shop")).toBeUndefined();
  });

  it("matches case-insensitively, like the router", () => {
    expect(ssrOf("/ADMIN/users")).toBe(false);
    expect(ssrOf("/About")).toBe(false);
  });

  it("lets the most specific pattern win", () => {
    expect(ssrOf("/admin/public/faq")).toBe(true);
  });

  it("only turns ssr off when ssr is on globally", () => {
    expect(isServerRendered(true, rules, "/admin/x")).toBe(false);
    expect(isServerRendered(true, rules, "/blog")).toBe(true);
    expect(isServerRendered(true, undefined, "/blog")).toBe(true);
    expect(isServerRendered(false, {}, "/blog")).toBe(false);
  });
});

describe("validateRouteRules", () => {
  it("rejects bad patterns and ssr: true without global ssr", () => {
    expect(() => validateRouteRules({ admin: {} }, true)).toThrow(
      'start with "/"',
    );
    expect(() =>
      validateRouteRules({ "/a": { ssr: "no" as any } }, true),
    ).toThrow("must be a boolean");
    expect(() => validateRouteRules({ "/a": { ssr: true } }, false)).toThrow(
      "needs ssr: true",
    );
    expect(() =>
      validateRouteRules({ "/a": { ssr: false } }, false),
    ).not.toThrow();
  });

  it("validates the fetch mode", () => {
    expect(() =>
      validateRouteRules({ "/a": { fetch: "xfetch" as any } }, true),
    ).toThrow("must be one of");
    expect(() =>
      validateRouteRules({ "/a": { fetch: "sfetch", ssr: false } }, true),
    ).toThrow("server-rendered");
    expect(() =>
      validateRouteRules({ "/a": { fetch: "sfetch" } }, false),
    ).toThrow("server-rendered");
    expect(() =>
      validateRouteRules({ "/a": { fetch: "pfetch", ssr: false } }, true),
    ).not.toThrow();
  });

  it("validates security options", () => {
    expect(() =>
      validateRouteRules(
        { "/a": { security: { headers: { "bad name": "x" } } } },
        true,
      ),
    ).toThrow('routeRules["/a"]');
    expect(() =>
      validateRouteRules(
        { "/a": { security: { csrf: false, csp: false } } },
        true,
      ),
    ).not.toThrow();
  });
});

describe("fetch mode per route", () => {
  const rules = {
    "/admin/**": { fetch: "sfetch" as const },
    "/admin/public/**": { fetch: "lfetch" as const },
    "/shop/*": { ssr: false },
  };

  it("resolves the most specific rule, falling back to the default", () => {
    expect(resolveFetchMode("dfetch", rules, "/admin/users")).toBe("sfetch");
    expect(resolveFetchMode("dfetch", rules, "/admin/public/faq")).toBe(
      "lfetch",
    );
    expect(resolveFetchMode("dfetch", rules, "/shop/shoes")).toBe("dfetch");
    expect(resolveFetchMode("dfetch", undefined, "/admin")).toBe("dfetch");
  });

  it("tells whether a mode is used by default or by any rule", () => {
    expect(usesFetchMode("lfetch", rules, "sfetch")).toBe(true);
    expect(usesFetchMode("pfetch", rules, "pfetch")).toBe(true);
    expect(usesFetchMode("lfetch", rules, "pfetch")).toBe(false);
    expect(usesFetchMode("lfetch", undefined, "pfetch")).toBe(false);
  });
});

describe("route security", () => {
  it("merges security options of matching rules one by one", () => {
    const merged = matchRouteRules(
      {
        "/a/**": { security: { csp: false, csrf: false } },
        "/a/bcd": { security: { csrf: true } },
      },
      "/a/bcd",
    );
    expect(merged.security).toEqual({ csp: false, csrf: true });
  });

  it("keeps security out of the public config", () => {
    const rules = { "/a": { ssr: false, security: { csrf: false } } };
    expect(toPublicRouteRules(rules)).toEqual({ "/a": { ssr: false } });
  });
});
