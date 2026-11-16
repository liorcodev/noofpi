import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyRequest, resolveProxyTarget } from "../src/server/proxy";

const base = "https://api.example.com";

describe("resolveProxyTarget", () => {
  it("maps proxy paths below the doofpi root to the remote API", () => {
    const target = resolveProxyTarget(
      "/_noofpi/proxy/doofpi.users.get",
      "?input=%7B%7D",
      base,
      "/doofpi",
    );
    expect(target?.href).toBe(
      "https://api.example.com/doofpi.users.get?input=%7B%7D",
    );
  });

  it.each([
    "/_noofpi/proxy/other.thing",
    "/_noofpi/proxy//evil.com/doofpi.x",
    "/_noofpi/proxy/doofpix",
    "/_noofpi/proxy/doofpi/../secret",
    "/other",
  ])("rejects %s", (pathname) => {
    expect(resolveProxyTarget(pathname, "", base, "/doofpi")).toBeNull();
  });
});

describe("proxyRequest", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const options = { base, root: "/doofpi" };

  it("forwards method, query, body and allowed headers, and returns the upstream response", async () => {
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("cookie")).toBe("a=1");
      expect(new Headers(init?.headers).has("x-secret")).toBe(false);
      expect(await new Response(init?.body).text()).toBe('{"a":1}');
      return new Response('{"ok":true}', {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
      });
    });
    globalThis.fetch = upstream as unknown as typeof fetch;

    const response = await proxyRequest(
      new Request("http://localhost/_noofpi/proxy/doofpi.items?x=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: "a=1",
          "x-secret": "s",
        },
        body: '{"a":1}',
      }),
      options,
    );

    expect(String(upstream.mock.calls[0]![0])).toBe(
      "https://api.example.com/doofpi.items?x=1",
    );
    expect(upstream.mock.calls[0]![1]?.method).toBe("POST");
    expect(response.status).toBe(201);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("keeps upstream error status and body", async () => {
    globalThis.fetch = (async () =>
      new Response('{"message":"nope"}', {
        status: 418,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const response = await proxyRequest(
      new Request("http://localhost/_noofpi/proxy/doofpi.x"),
      options,
    );

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ message: "nope" });
  });

  it("lets the hook change headers or short-circuit", async () => {
    const upstream = vi.fn(async () => new Response("ok"));
    globalThis.fetch = upstream as unknown as typeof fetch;

    await proxyRequest(new Request("http://localhost/_noofpi/proxy/doofpi.x"), {
      ...options,
      hook: ({ headers }) => void headers.set("authorization", "Bearer t"),
    });
    expect(
      new Headers((upstream.mock.calls[0] as any)[1].headers).get(
        "authorization",
      ),
    ).toBe("Bearer t");

    const blocked = await proxyRequest(
      new Request("http://localhost/_noofpi/proxy/doofpi.x"),
      {
        ...options,
        hook: () => new Response("no", { status: 401 }),
      },
    );
    expect(blocked.status).toBe(401);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("answers 502 when the upstream is unreachable and 404 outside the root", async () => {
    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;

    expect(
      (
        await proxyRequest(
          new Request("http://localhost/_noofpi/proxy/doofpi.x"),
          options,
        )
      ).status,
    ).toBe(502);
    expect(
      (
        await proxyRequest(
          new Request("http://localhost/_noofpi/proxy/nope.x"),
          options,
        )
      ).status,
    ).toBe(404);
  });
});
