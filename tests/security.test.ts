import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config";
import { resolveHead, applyHead } from "../src/head";
import { isCrossSiteWrite, resolveSecurity } from "../src/security";
import { createHandler } from "../src/server/handler";
import { SSR_OUTLET, type ServerConfig } from "../src/server/types";

describe("resolveSecurity", () => {
  it("enables the default headers and csrf", () => {
    const security = resolveSecurity();
    expect(security.headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(security.csrf).toEqual({ allowedOrigins: [] });
  });

  it("overrides, removes (case-insensitively) and disables headers", () => {
    const { headers } = resolveSecurity({
      headers: { "x-frame-options": "DENY", "Referrer-Policy": false },
    });
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["X-Frame-Options"]).toBeUndefined();
    expect(headers["Referrer-Policy"]).toBeUndefined();
    expect(resolveSecurity({ headers: false }).headers).toEqual({});
  });

  it("drops X-Frame-Options when the csp sets frame-ancestors", () => {
    expect(
      resolveSecurity({
        csp: { directives: { "frame-ancestors": ["'self'", "https://a.io"] } },
      }).headers["X-Frame-Options"],
    ).toBeUndefined();
  });

  it("rejects bad header names/values and bad csrf origins", () => {
    expect(() => resolveSecurity({ headers: { "Bad Name": "x" } })).toThrow(
      "header name",
    );
    expect(() =>
      resolveSecurity({ headers: { X: "a\r\nSet-Cookie: b" } }),
    ).toThrow("control characters");
    expect(() =>
      resolveSecurity({ csrf: { allowedOrigins: ["nope"] } }),
    ).toThrow("allowedOrigins");
    expect(
      resolveSecurity({ csrf: { allowedOrigins: ["https://a.io/x"] } }).csrf,
    ).toEqual({ allowedOrigins: ["https://a.io"] });
    expect(resolveSecurity({ csrf: false }).csrf).toBe(false);
  });

  it("is part of resolveConfig", () => {
    expect(resolveConfig().security.headers["X-Content-Type-Options"]).toBe(
      "nosniff",
    );
  });
});

describe("isCrossSiteWrite", () => {
  const csrf = { allowedOrigins: ["https://trusted.io"] };
  const url = new URL("https://site.com/doofpi.x");
  const check = (method: string, headers: Record<string, string> = {}) =>
    isCrossSiteWrite(new Request(url, { method, headers }), url, csrf);

  it("lets reads, same-origin writes, allowed origins and non-browsers through", () => {
    expect(check("GET", { origin: "https://evil.com" })).toBe(false);
    expect(check("POST", { origin: "https://site.com" })).toBe(false);
    // scheme is not compared: a TLS-terminating proxy may hide https
    expect(check("POST", { origin: "http://site.com" })).toBe(false);
    expect(check("POST", { origin: "https://trusted.io" })).toBe(false);
    expect(check("POST")).toBe(false);
    expect(check("POST", { "sec-fetch-site": "same-origin" })).toBe(false);
  });

  it("compares full origins, scheme included, when publicOrigin is set", () => {
    const strict = { ...csrf, publicOrigin: "https://site.com" };
    const run = (origin: string) =>
      isCrossSiteWrite(
        new Request(url, { method: "POST", headers: { origin } }),
        url,
        strict,
      );
    expect(run("https://site.com")).toBe(false);
    expect(run("https://trusted.io")).toBe(false);
    expect(run("http://site.com")).toBe(true);
    expect(run("https://evil.com")).toBe(true);
    expect(
      resolveSecurity({ csrf: { publicOrigin: "https://site.com/x" } }).csrf,
    ).toEqual({ allowedOrigins: [], publicOrigin: "https://site.com" });
    expect(() => resolveSecurity({ csrf: { publicOrigin: "nope" } })).toThrow(
      "publicOrigin",
    );
  });

  it("blocks cross-site writes", () => {
    expect(check("POST", { origin: "https://evil.com" })).toBe(true);
    expect(check("DELETE", { origin: "null" })).toBe(true);
    expect(check("PUT", { "sec-fetch-site": "cross-site" })).toBe(true);
    expect(check("PATCH", { "sec-fetch-site": "same-site" })).toBe(true);
  });
});

describe("body limit and allowed hosts", () => {
  const make = (
    security: Parameters<typeof resolveSecurity>[0],
    routeRules?: Record<string, { security: { bodyLimit: number | false } }>,
  ) => {
    const doofpi = {
      fetch: vi.fn(
        async (request: Request) => new Response(await request.text()),
      ),
    };
    const handler = createHandler({
      load: async () => ({
        config: {
          ssr: false,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
          security: resolveSecurity({ csrf: false, ...security }),
          routeRules,
        },
        doofpi,
      }),
      getTemplate: async () => "<html></html>",
    });
    const post = (body: string, path = "/doofpi.x", headers = {}) =>
      handler(
        new Request(`https://site.com${path}`, {
          method: "POST",
          body,
          headers,
        }),
      );
    return { handler, doofpi, post };
  };

  it("validates the options", () => {
    expect(resolveSecurity().bodyLimit).toBe(10 * 1024 * 1024);
    expect(resolveSecurity({ bodyLimit: false }).bodyLimit).toBe(false);
    expect(() => resolveSecurity({ bodyLimit: -1 })).toThrow("bodyLimit");
    expect(() => resolveSecurity({ allowedHosts: ["a b"] })).toThrow(
      "allowedHosts",
    );
  });

  it("413s bodies over the limit by Content-Length, without calling the api", async () => {
    const { post, doofpi } = make({ bodyLimit: 5 });
    expect(
      (await post("123456", "/doofpi.x", { "content-length": "6" })).status,
    ).toBe(413);
    expect(doofpi.fetch).not.toHaveBeenCalled();
    const ok = await post("12345");
    expect(await ok.text()).toBe("12345");
  });

  it("413s streamed bodies that grow past the limit", async () => {
    const { handler } = make({ bodyLimit: 5 });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("5678"));
        controller.close();
      },
    });
    const response = await handler(
      new Request("https://site.com/doofpi.x", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
  });

  it("lets routeRules change the limit", async () => {
    const { post } = make(
      { bodyLimit: 5 },
      {
        "/doofpi/upload/**": { security: { bodyLimit: 50 } },
        "/doofpi/tiny/**": { security: { bodyLimit: false } },
      },
    );
    expect((await post("x".repeat(20))).status).toBe(413);
    expect((await post("x".repeat(20), "/doofpi/upload/a")).status).toBe(200);
    expect((await post("x".repeat(200), "/doofpi/tiny/a")).status).toBe(200);
  });

  it("400s requests for hosts that are not allowed", async () => {
    const { handler } = make({
      allowedHosts: ["site.com", "*.example.com"],
    });
    const ask = (host: string) => handler(new Request(`https://${host}/`));
    expect((await ask("site.com")).status).toBe(200);
    expect((await ask("app.example.com")).status).toBe(200);
    expect((await ask("example.com")).status).toBe(400);
    expect((await ask("evil.com")).status).toBe(400);
  });
});

describe("createHandler security", () => {
  const template = `<html><head><title>x</title></head><body><div id="app">${SSR_OUTLET}</div></body></html>`;
  const make = (security: ServerConfig["security"], protocol = "https") => {
    const doofpi = { fetch: vi.fn(async () => new Response("api")) };
    const handler = createHandler({
      load: async () => ({
        config: {
          ssr: false,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
          security,
        },
        doofpi,
      }),
      getTemplate: async () => template,
    });
    const req = (path: string, init?: RequestInit) =>
      new Request(`${protocol}://site.com${path}`, init);
    return { handler, doofpi, req };
  };

  it("403s cross-site writes to the api without calling it", async () => {
    const { handler, doofpi, req } = make(resolveSecurity());
    const blocked = await handler(
      req("/doofpi.x", {
        method: "POST",
        headers: { origin: "https://evil.com" },
      }),
    );
    expect(blocked.status).toBe(403);
    expect(doofpi.fetch).not.toHaveBeenCalled();
    const ok = await handler(
      req("/doofpi.x", {
        method: "POST",
        headers: { origin: "https://site.com" },
      }),
    );
    expect(await ok.text()).toBe("api");
  });

  it("does not check when csrf is off", async () => {
    const { handler, req } = make(resolveSecurity({ csrf: false }));
    const response = await handler(
      req("/doofpi.x", {
        method: "POST",
        headers: { origin: "https://evil.com" },
      }),
    );
    expect(await response.text()).toBe("api");
  });

  it("adds headers to every response without overriding, and HSTS only over https", async () => {
    const { handler, req } = make(resolveSecurity());
    const page = await handler(req("/"));
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("strict-transport-security")).toBe(
      "max-age=15552000",
    );
    expect((await handler(req("/x.ico"))).headers.get("x-frame-options")).toBe(
      "SAMEORIGIN",
    );

    const http = make(resolveSecurity(), "http");
    expect(
      (await http.handler(http.req("/"))).headers.get(
        "strict-transport-security",
      ),
    ).toBeNull();

    const custom = make(resolveSecurity());
    const handlerWithMw = createHandler({
      load: async () => ({
        config: {
          ssr: false,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
          security: resolveSecurity(),
        },
        middleware: [
          async () =>
            new Response("x", { headers: { "X-Frame-Options": "DENY" } }),
        ],
      }),
      getTemplate: async () => template,
    });
    expect(
      (await handlerWithMw(custom.req("/"))).headers.get("x-frame-options"),
    ).toBe("DENY");
  });

  it("adds headers to immutable responses too", async () => {
    const handler = createHandler({
      load: async () => ({
        config: {
          ssr: false,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
          security: resolveSecurity(),
        },
        middleware: [
          async () => {
            const response = Response.redirect("https://site.com/b", 302);
            return response;
          },
        ],
      }),
      getTemplate: async () => template,
    });
    const response = await handler(new Request("https://site.com/a"));
    expect(response.status).toBe(302);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("applies routeRules security per path", async () => {
    const doofpi = { fetch: vi.fn(async () => new Response("api")) };
    const handler = createHandler({
      load: async () => ({
        config: {
          ssr: false,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
          security: resolveSecurity({
            csp: { directives: { "default-src": ["'self'"] } },
          }),
          routeRules: {
            "/doofpi/**": { security: { csrf: false } },
            "/embed/**": {
              security: {
                csp: false,
                headers: { "X-Frame-Options": false, "X-Extra": "1" },
              },
            },
          },
        },
        doofpi,
      }),
      getTemplate: async () => template,
    });
    const url = (path: string) => `https://site.com${path}`;

    const write = await handler(
      new Request(url("/doofpi/x"), {
        method: "POST",
        headers: { origin: "https://evil.com" },
      }),
    );
    expect(await write.text()).toBe("api");

    const embed = await handler(new Request(url("/embed/a")));
    expect(embed.headers.get("content-security-policy")).toBeNull();
    expect(embed.headers.get("x-frame-options")).toBeNull();
    expect(embed.headers.get("x-extra")).toBe("1");
    expect(embed.headers.get("x-content-type-options")).toBe("nosniff");

    const other = await handler(new Request(url("/")));
    expect(other.headers.get("content-security-policy")).toBe(
      "default-src 'self'",
    );
    expect(other.headers.get("x-extra")).toBeNull();
  });
});

describe("head attribute names", () => {
  it("drops names that could inject attributes or handlers", () => {
    const head = resolveHead(undefined, [
      {
        meta: [
          { name: "a", content: "b", 'x" onload="alert(1)': "y", onclick: "z" },
        ],
        bodyAttrs: { class: "ok", onload: "alert(1)", "a b": "c" },
      },
    ]);
    expect(head.meta[0]).toEqual({ name: "a", content: "b" });
    expect(head.bodyAttrs).toEqual({ class: "ok" });
    expect(
      applyHead("<html><head></head><body></body></html>", head),
    ).not.toContain("onload");
  });
});
