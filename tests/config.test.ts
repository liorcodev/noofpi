import { describe, expect, it } from "vitest";
import { resolveConfig, toPublicConfig } from "../src/config";

describe("resolveConfig", () => {
  it("applies defaults", () => {
    expect(resolveConfig()).toMatchObject({
      ssr: true,
      tailwind: false,
      autoImports: true,
      doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
    });
  });

  it("requires an absolute http(s) url for remote modes", () => {
    for (const fetch of ["dfetch", "pfetch", "sfetch"] as const) {
      expect(() => resolveConfig({ doofpi: { fetch } })).toThrow(
        "doofpi.url is required",
      );
      expect(() =>
        resolveConfig({ doofpi: { fetch, url: "api.example.com" } }),
      ).toThrow("absolute http(s) URL");
    }
    expect(
      resolveConfig({
        doofpi: { fetch: "pfetch", url: "https://api.example.com/x" },
      }).doofpi.url,
    ).toBe("https://api.example.com");
  });

  it("rejects sfetch without ssr", () => {
    expect(() =>
      resolveConfig({
        ssr: false,
        doofpi: { fetch: "sfetch", url: "https://a.io" },
      }),
    ).toThrow("ssr: true");
  });

  it("resolves and validates the build preset", () => {
    expect(resolveConfig().build.preset).toBe("node");
    expect(
      resolveConfig({ build: { preset: "cloudflare-pages" } }).build.preset,
    ).toBe("cloudflare-pages");
    expect(() =>
      resolveConfig({ build: { preset: "vercel" as never } }),
    ).toThrow("build.preset must be one of");
  });

  it("rejects bad routeRules", () => {
    expect(() => resolveConfig({ routeRules: { admin: {} } })).toThrow(
      "routeRules",
    );
    expect(() =>
      resolveConfig({ ssr: false, routeRules: { "/a": { ssr: true } } }),
    ).toThrow("ssr: true");
  });

  it("requires doofpi.url when a route rule uses a remote mode", () => {
    expect(() =>
      resolveConfig({ routeRules: { "/admin/**": { fetch: "sfetch" } } }),
    ).toThrow('routeRules["/admin/**"].fetch is "sfetch"');
    expect(
      resolveConfig({
        routeRules: { "/admin/**": { fetch: "sfetch" } },
        doofpi: { url: "https://api.example.com/x" },
      }).doofpi.url,
    ).toBe("https://api.example.com");
    expect(() =>
      resolveConfig({ routeRules: { "/a": { fetch: "lfetch" } } }),
    ).not.toThrow();
  });

  it("rejects unknown modes and bad roots", () => {
    expect(() => resolveConfig({ doofpi: { fetch: "xfetch" as any } })).toThrow(
      "must be one of",
    );
    expect(() => resolveConfig({ doofpi: { root: "doofpi" } })).toThrow(
      "doofpi.root",
    );
    expect(() => resolveConfig({ doofpi: { root: "/doofpi/" } })).toThrow(
      "doofpi.root",
    );
  });
});

describe("toPublicConfig", () => {
  it("enables the devtools by default and lets the config turn them off", () => {
    expect(resolveConfig().devtools).toBe(true);
    expect(toPublicConfig(resolveConfig()).devtools).toBe(true);
    expect(toPublicConfig(resolveConfig({ devtools: false })).devtools).toBe(
      false,
    );
  });

  it("only exposes the remote url to the browser for dfetch", () => {
    const url = "https://api.example.com";
    expect(
      toPublicConfig(resolveConfig({ doofpi: { fetch: "dfetch", url } })).doofpi
        .url,
    ).toBe(url);
    expect(
      toPublicConfig(resolveConfig({ doofpi: { fetch: "pfetch", url } })).doofpi
        .url,
    ).toBeUndefined();
    expect(
      toPublicConfig(resolveConfig({ doofpi: { fetch: "sfetch", url } })).doofpi
        .url,
    ).toBeUndefined();
  });

  it("exposes the remote url when a route rule uses dfetch", () => {
    const url = "https://api.example.com";
    const config = toPublicConfig(
      resolveConfig({
        routeRules: { "/public/**": { fetch: "dfetch" } },
        doofpi: { url },
      }),
    );
    expect(config.doofpi).toMatchObject({ fetch: "lfetch", url });
    expect(config.routeRules["/public/**"]).toEqual({ fetch: "dfetch" });
  });
});
