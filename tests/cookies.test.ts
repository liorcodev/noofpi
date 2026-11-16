import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  applyCookies,
  createCookieJar,
  defineCookie,
  enumCodec,
  jsonCodec,
  numberCodec,
  parseCookies,
  serializeCookie,
} from "../src/cookies";
import { COOKIES_KEY, useCookie } from "../src/runtime/cookie";

describe("parseCookies", () => {
  it("parses pairs, decodes values and keeps the first of a name", () => {
    expect({ ...parseCookies('a=1; b=%20x; c="q"; a=2; bad; =x') }).toEqual({
      a: "1",
      b: " x",
      c: "q",
    });
  });

  it("keeps undecodable values as they are", () => {
    expect(parseCookies("a=%E0%A4%A")["a"]).toBe("%E0%A4%A");
  });

  it("is safe against prototype names", () => {
    const cookies = parseCookies("__proto__=x");
    expect(Object.getPrototypeOf(cookies)).toBe(null);
    expect(({} as any).x).toBeUndefined();
  });
});

describe("serializeCookie", () => {
  it("writes the attributes", () => {
    expect(
      serializeCookie("a", "x y;z", {
        path: "/",
        domain: "example.com",
        maxAge: 60.9,
        expires: new Date(0),
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      }),
    ).toBe(
      "a=x%20y%3Bz; Path=/; Domain=example.com; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict",
    );
  });

  it("forces Secure where browsers require it", () => {
    expect(serializeCookie("a", "", { sameSite: "none" })).toContain("Secure");
    expect(serializeCookie("__Host-a", "")).toContain("Secure");
    expect(serializeCookie("a", "", { partitioned: true })).toContain(
      "Secure; Partitioned",
    );
  });

  it("rejects names and attributes that could inject headers or attributes", () => {
    expect(() => serializeCookie("a b", "")).toThrow(/name/);
    expect(() => serializeCookie("a=b", "")).toThrow(/name/);
    expect(() => serializeCookie("a", "", { path: "/; Secure" })).toThrow(
      /path/,
    );
    expect(() => serializeCookie("a", "", { domain: "x\r\ny" })).toThrow(
      /domain/,
    );
    expect(() => serializeCookie("a", "", { maxAge: NaN })).toThrow(/maxAge/);
    expect(() => serializeCookie("a", "x".repeat(5000))).toThrow(/larger/);
  });
});

describe("codecs", () => {
  it("round-trips typed values", () => {
    const jar = createCookieJar();
    jar.set("n", 42, { codec: numberCodec });
    jar.set("o", { a: [1, "é"] }, { codec: jsonCodec<{ a: unknown[] }>() });
    expect(jar.get("n", numberCodec)).toBe(42);
    expect(jar.get("o", jsonCodec())).toEqual({ a: [1, "é"] });
    expect(jar.get("n")).toBe("42");
  });

  it("treats values the codec rejects as absent", () => {
    const jar = createCookieJar({ cookie: "n=abc; t=blue; j={" });
    expect(jar.get("n", numberCodec)).toBeUndefined();
    expect(jar.get("t", enumCodec(["light", "dark"]))).toBeUndefined();
    expect(jar.get("j", jsonCodec())).toBeUndefined();
    expect(jar.has("n")).toBe(true);
  });

  it("supports a codec that wraps the value in a custom type", () => {
    type UserId = string & { readonly brand: "UserId" };
    const userId = defineCookie<UserId>("uid", {
      codec: {
        encode: (id) => `u-${id}`,
        decode: (raw) => {
          if (!raw.startsWith("u-")) throw new Error("bad");
          return raw.slice(2) as UserId;
        },
      },
      maxAge: 10,
    });
    const jar = createCookieJar();
    jar.set(userId, "42" as UserId);
    expect(jar.toSetCookieHeaders()).toEqual([
      "uid=u-42; Path=/; Max-Age=10; HttpOnly; SameSite=Lax",
    ]);
    expect(jar.get(userId)).toBe("42");
  });
});

describe("createCookieJar", () => {
  it("reads the request cookies and sees its own changes", () => {
    const jar = createCookieJar({ cookie: "a=1; b=2" });
    expect(jar.getAll()).toEqual({ a: "1", b: "2" });
    jar.set("a", "9");
    jar.remove("b");
    jar.set("c", "3");
    expect(jar.getAll()).toEqual({ a: "9", c: "3" });
    expect(jar.has("b")).toBe(false);
  });

  it("queues secure defaults and merges options: call > definition > defaults", () => {
    const jar = createCookieJar({ defaults: { secure: true, path: "/app" } });
    jar.set("a", "1");
    jar.set(defineCookie("b", { sameSite: "strict", maxAge: 5 }), "2", {
      maxAge: 9,
      httpOnly: false,
    });
    expect(jar.toSetCookieHeaders()).toEqual([
      "a=1; Path=/app; HttpOnly; Secure; SameSite=Lax",
      "b=2; Path=/app; Max-Age=9; Secure; SameSite=Strict",
    ]);
  });

  it("keeps the last write per cookie and expires removed cookies with the same scope", () => {
    const jar = createCookieJar({ cookie: "a=1" });
    jar.set("a", "2");
    jar.set("a", "3");
    jar.remove("s", { path: "/x", domain: "example.com" });
    expect(jar.toSetCookieHeaders()).toEqual([
      "a=3; Path=/; HttpOnly; SameSite=Lax",
      "s=; Path=/x; Domain=example.com; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    ]);
  });

  it("writes through (without HttpOnly) when given a writer", () => {
    let store = "a=1";
    const write = vi.fn((header: string) => {
      store = header;
    });
    const jar = createCookieJar({ cookie: () => store, write });
    expect(jar.get("a")).toBe("1");
    jar.set("a", "2");
    expect(write).toHaveBeenCalledWith("a=2; Path=/; SameSite=Lax");
    expect(jar.get("a")).toBe("2");
    expect(jar.toSetCookieHeaders()).toEqual([]);
  });
});

describe("applyCookies", () => {
  it("appends to mutable and immutable responses", async () => {
    const jar = createCookieJar();
    jar.set("a", "1");
    jar.set("b", "2");
    const plain = applyCookies(new Response("x", { status: 201 }), jar);
    expect(plain.headers.getSetCookie()).toHaveLength(2);
    const immutable = applyCookies(Response.redirect("http://x/", 302), jar);
    expect(immutable.status).toBe(302);
    expect(immutable.headers.getSetCookie()).toHaveLength(2);
    expect(
      await applyCookies(new Response("x"), createCookieJar()).text(),
    ).toBe("x");
  });
});

describe("useCookie", () => {
  const render = async (
    jar: ReturnType<typeof createCookieJar>,
    setup: () => unknown,
  ) => {
    const app = createSSRApp(
      defineComponent({
        setup() {
          const result = setup();
          return () => h("p", String(result));
        },
      }),
    );
    app.provide(COOKIES_KEY, jar);
    return renderToString(app);
  };

  it("renders the request's value, with a default and a codec", async () => {
    const jar = createCookieJar({ cookie: 'prefs={"n":1}; theme=dark' });
    const html = await render(jar, () => {
      const prefs = useCookie("prefs", { codec: jsonCodec<{ n: number }>() });
      const theme = useCookie("theme", { default: () => "light" });
      const missing = useCookie("missing", { default: () => "fallback" });
      return [prefs.value?.n, theme.value, missing.value].join(",");
    });
    expect(html).toBe("<p>1,dark,fallback</p>");
    expect(jar.toSetCookieHeaders()).toEqual([]);
  });

  it("writes on assignment, readable by scripts, and removes on undefined", async () => {
    const jar = createCookieJar({ cookie: "old=1" });
    await render(jar, () => {
      const count = useCookie("count", { codec: numberCodec, maxAge: 60 });
      count.value = 5;
      const old = useCookie("old");
      old.value = undefined;
    });
    expect(jar.toSetCookieHeaders()).toEqual([
      "count=5; Path=/; Max-Age=60; SameSite=Lax",
      "old=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    ]);
  });

  it("uses a shared definition, keeping its own HttpOnly choice", async () => {
    const session = defineCookie("sid", { httpOnly: true });
    const jar = createCookieJar();
    await render(jar, () => {
      useCookie(session).value = "abc";
    });
    expect(jar.toSetCookieHeaders()).toEqual([
      "sid=abc; Path=/; HttpOnly; SameSite=Lax",
    ]);
  });

  it("throws outside of an app", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => useCookie("a")).toThrow(/setup/);
    warn.mockRestore();
  });
});
