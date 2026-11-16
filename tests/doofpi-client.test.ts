import { describe, expect, it, vi } from "vitest";
import {
  createDoofpiClient,
  createDoofpiClients,
  type DoofpiClientConfig,
} from "../src/runtime/doofpi-client";
import { createRequestLog } from "../src/runtime/inspector";

const json = () =>
  new Response('{"ok":true}', {
    headers: { "Content-Type": "application/json" },
  });
const config = (fetch: DoofpiClientConfig["fetch"]): DoofpiClientConfig => ({
  fetch,
  url: "https://api.example.com",
  root: "/doofpi",
});

// Calls `client.hello.read()` and returns the url + init the transport received
const call = async (
  cfg: DoofpiClientConfig,
  ctx: Parameters<typeof createDoofpiClient>[1],
) => {
  const transport = vi.fn(async () => json());
  const client = createDoofpiClient(cfg, {
    ...ctx,
    fetch: ctx.fetch ?? transport,
  }) as any;
  const original = globalThis.fetch;
  globalThis.fetch = transport as unknown as typeof fetch;
  try {
    await client.hello.read();
  } finally {
    globalThis.fetch = original;
  }
  const [url, init] = transport.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  return { url, headers: new Headers(init.headers) };
};

const browser = { server: false, origin: "http://app.test" };
const server = { server: true, origin: "http://app.test", cookie: "sid=1" };

describe("createDoofpiClient", () => {
  it("dfetch goes straight to the remote api, without forwarding cookies", async () => {
    for (const ctx of [browser, server]) {
      const { url, headers } = await call(config("dfetch"), ctx);
      expect(url).toBe("https://api.example.com/doofpi.hello");
      expect(headers.has("cookie")).toBe(false);
    }
  });

  it("pfetch goes through the noofpi proxy", async () => {
    expect((await call(config("pfetch"), browser)).url).toBe(
      "http://app.test/_noofpi/proxy/doofpi.hello",
    );
    const ssr = await call(config("pfetch"), server);
    expect(ssr.url).toBe("http://app.test/_noofpi/proxy/doofpi.hello");
    expect(ssr.headers.get("cookie")).toBe("sid=1");
  });

  it("lfetch targets the noofpi server and forwards the cookie on the server", async () => {
    expect((await call(config("lfetch"), browser)).url).toBe(
      "http://app.test/doofpi.hello",
    );
    const ssr = await call(config("lfetch"), server);
    expect(ssr.url).toBe("http://app.test/doofpi.hello");
    expect(ssr.headers.get("cookie")).toBe("sid=1");
  });

  it("server-side pfetch/lfetch use the in-process fetch instead of the network", async () => {
    const networkFetch = vi.fn(async () => json());
    const original = globalThis.fetch;
    globalThis.fetch = networkFetch as unknown as typeof fetch;
    try {
      const inProcess = vi.fn(async () => json());
      for (const mode of ["pfetch", "lfetch"] as const) {
        const client = createDoofpiClient(config(mode), {
          ...server,
          fetch: inProcess,
        }) as any;
        expect(await client.hello.read()).toEqual({ ok: true });
      }
      expect(inProcess).toHaveBeenCalledTimes(2);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("sfetch calls the remote api on the server and refuses in the browser", async () => {
    expect((await call(config("sfetch"), server)).url).toBe(
      "https://api.example.com/doofpi.hello",
    );
    const client = createDoofpiClient(config("sfetch"), browser) as any;
    await expect(client.hello.read()).rejects.toThrow(
      "only allowed on the server",
    );
  });
});

describe("createDoofpiClients", () => {
  it("picks the client by route rule and reuses one client per mode", () => {
    const clients = createDoofpiClients(
      config("lfetch"),
      { "/admin/**": { fetch: "sfetch" }, "/docs/**": { fetch: "sfetch" } },
      browser,
    );
    const admin = clients.forPath("/admin/users");
    // doofpi clients are proxies that vitest cannot print, so compare identity directly
    expect(Object.is(admin, clients.forPath("/docs/intro"))).toBe(true);
    expect(Object.is(admin, clients.forPath("/home"))).toBe(false);
    expect(Object.is(clients.forPath("/home"), clients.forPath("/about"))).toBe(
      true,
    );
  });

  it("sends each route through its own mode", async () => {
    const transport = vi.fn(async (_url: string) => json());
    const original = globalThis.fetch;
    globalThis.fetch = transport as unknown as typeof fetch;
    try {
      const clients = createDoofpiClients(
        config("lfetch"),
        { "/admin/**": { fetch: "pfetch" } },
        browser,
      );
      await (clients.forPath("/home") as any).hello.read();
      await (clients.forPath("/admin") as any).hello.read();
    } finally {
      globalThis.fetch = original;
    }
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "http://app.test/doofpi.hello",
      "http://app.test/_noofpi/proxy/doofpi.hello",
    ]);
  });

  it("forMode returns the client of an enabled mode and rejects others", () => {
    const clients = createDoofpiClients(
      config("lfetch"),
      { "/admin/**": { fetch: "sfetch" } },
      browser,
    );
    expect(
      Object.is(clients.forMode("sfetch"), clients.forPath("/admin")),
    ).toBe(true);
    expect(Object.is(clients.forMode("lfetch"), clients.forPath("/home"))).toBe(
      true,
    );
    expect(() => clients.forMode("dfetch")).toThrow('needs "dfetch"');
    expect(() => clients.forMode("xfetch" as any)).toThrow("must be one of");
  });

  it("records requests with mode, transport, status and timing when a log is given", async () => {
    const log = createRequestLog();
    const inProcess = vi.fn(async () => json());
    const ssr = createDoofpiClient(config("lfetch"), {
      ...server,
      fetch: inProcess,
      log,
    }) as any;
    await ssr.hello.read();

    const remote = vi.fn(async () => new Response("{}", { status: 502 }));
    const original = globalThis.fetch;
    globalThis.fetch = remote as unknown as typeof fetch;
    try {
      await (
        createDoofpiClient(config("dfetch"), { ...browser, log }) as any
      ).hello.read();
    } catch {
      // doofpi throws for the 502
    } finally {
      globalThis.fetch = original;
    }

    expect(log.list).toMatchObject([
      {
        side: "server",
        mode: "lfetch",
        transport: "in-process",
        method: "GET",
        url: "http://app.test/doofpi.hello",
        status: 200,
      },
      {
        side: "browser",
        mode: "dfetch",
        transport: "http",
        url: "https://api.example.com/doofpi.hello",
        status: 502,
      },
    ]);
    expect(log.list.every((entry) => typeof entry.ms === "number")).toBe(true);
  });

  it("records failed requests and rethrows", async () => {
    const log = createRequestLog();
    const client = createDoofpiClient(config("lfetch"), {
      ...server,
      fetch: async () => Promise.reject(new Error("boom")),
      log,
    }) as any;
    await expect(client.hello.read()).rejects.toThrow("boom");
    expect(log.list[0]).toMatchObject({ error: "boom" });
    expect(log.list[0]!.status).toBeUndefined();
  });
});
