import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";
import {
  buildCspHeader,
  injectNonce,
  usesNonce,
  validateCsp,
} from "../src/csp";
import { createHandler } from "../src/server/handler";
import { SSR_OUTLET, type ServerModule } from "../src/server/types";

describe("buildCspHeader", () => {
  it("renders directives, bare booleans, and swaps 'nonce' for the real one", () => {
    const [name, value] = buildCspHeader(
      {
        directives: {
          "default-src": "'self'",
          "script-src": ["'self'", "'nonce'"],
          "upgrade-insecure-requests": true,
          "img-src": false,
        },
      },
      "abc",
    );
    expect(name).toBe("Content-Security-Policy");
    expect(value).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc'; upgrade-insecure-requests",
    );
    expect(buildCspHeader({ directives: {}, reportOnly: true })[0]).toBe(
      "Content-Security-Policy-Report-Only",
    );
  });

  it("detects nonce use", () => {
    expect(usesNonce({ directives: { "script-src": "'self' 'nonce'" } })).toBe(
      true,
    );
    expect(usesNonce({ directives: { "script-src": "'self'" } })).toBe(false);
    expect(usesNonce(undefined)).toBe(false);
  });
});

describe("validateCsp", () => {
  it("rejects bad names and values that could break the header", () => {
    expect(() => validateCsp({ directives: { scriptSrc: "'self'" } })).toThrow(
      "valid directive name",
    );
    expect(() =>
      validateCsp({ directives: { "script-src": "'self'; img-src *" } }),
    ).toThrow("invalid source");
    expect(() =>
      validateCsp({ directives: { "script-src": ["a\r\nX: y"] } }),
    ).toThrow("invalid source");
    expect(() =>
      validateCsp({ directives: { "img-src": 1 as never } }),
    ).toThrow("string");
  });

  it("runs from resolveConfig", () => {
    expect(() =>
      resolveConfig({ security: { csp: { directives: { "Bad Name": "x" } } } }),
    ).toThrow("security.csp");
  });
});

describe("injectNonce", () => {
  it("nonces scripts, styles, stylesheet and preload links, and adds the meta", () => {
    const html = injectNonce(
      `<html><head><link rel="stylesheet" href="/a.css" /><link rel="icon" href="/i.ico" /><link rel="modulepreload" href="/m.js"><style>a{}</style></head><body><script type="module" src="/e.js"></script><script nonce="keep">1</script></body></html>`,
      "N",
    );
    expect(html).toContain('<link rel="stylesheet" href="/a.css" nonce="N" />');
    expect(html).toContain('<link rel="icon" href="/i.ico" />');
    expect(html).toContain('<link rel="modulepreload" href="/m.js" nonce="N">');
    expect(html).toContain('<style nonce="N">');
    expect(html).toContain('<script type="module" src="/e.js" nonce="N">');
    expect(html).toContain('<script nonce="keep">');
    expect(html).toContain('<meta property="csp-nonce" nonce="N" />');
  });
});

describe("createHandler with csp", () => {
  const template = `<html><head><title>x</title><link rel="stylesheet" href="/a.css" /></head><body><div id="app">${SSR_OUTLET}</div><script type="module" src="/e.js"></script></body></html>`;
  const make = (csp: NonNullable<ServerModule["config"]["security"]>["csp"]) =>
    createHandler({
      load: async () => ({
        config: {
          ssr: true,
          doofpi: { fetch: "lfetch", url: undefined, root: "/doofpi" },
          security: { csp },
        },
        render: async () => ({
          html: "<script>evil()</script>",
          status: 200,
          payload: { data: { a: 1 }, errors: {} },
        }),
      }),
      getTemplate: async () => template,
    });
  const get = () => new Request("http://localhost/");

  it("sends a fresh nonce per request, in the header and the shell only", async () => {
    const handler = make({
      directives: {
        "script-src": ["'self'", "'nonce'"],
        "style-src": "'nonce'",
      },
    });
    const nonces: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await handler(get());
      const body = await response.text();
      const nonce = /'nonce-([^']+)'/.exec(
        response.headers.get("content-security-policy")!,
      )![1]!;
      nonces.push(nonce);
      expect(body).toContain(`href="/a.css" nonce="${nonce}"`);
      expect(body).toContain(`src="/e.js" nonce="${nonce}"`);
      expect(body).toContain("<script>evil()</script>");
      expect(body).not.toContain(`<script nonce="${nonce}">evil`);
    }
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("sends a static policy untouched when there is no nonce", async () => {
    const response = await make({
      directives: { "default-src": "'self'" },
    })(get());
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'",
    );
    expect(await response.text()).not.toContain("nonce=");
  });

  it("adds no header without csp", async () => {
    const response = await make(undefined)(get());
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
