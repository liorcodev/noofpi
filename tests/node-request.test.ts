import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { toWebRequest } from "../src/server/node";

const fake = (url: string | undefined, host = "victim.com") =>
  ({ url, method: "GET", headers: { host } }) as unknown as IncomingMessage;

describe("toWebRequest", () => {
  it("keeps the Host header's host even for a protocol-relative target", () => {
    const url = new URL(toWebRequest(fake("//attacker.com/doofpi/x?a=1")).url);
    expect(url.host).toBe("victim.com");
    expect(url.pathname).toBe("//attacker.com/doofpi/x");
    expect(url.search).toBe("?a=1");
  });

  it("falls back to / for non-path targets", () => {
    expect(new URL(toWebRequest(fake("*")).url).pathname).toBe("/");
    expect(new URL(toWebRequest(fake("http://evil.com/x")).url).host).toBe(
      "victim.com",
    );
    expect(new URL(toWebRequest(fake(undefined)).url).pathname).toBe("/");
  });
});
