import { describe, expect, it } from "vitest";
import Doofpi from "doofpi";
import { z } from "zod";
import {
  useDoofpi,
  type DoofpiClient,
  type RegisteredLocalRoutes,
  type RegisteredRemoteRoutes,
  type RoutesForMode,
} from "../src/runtime/doofpi-client";
import { useDoofpiFetch } from "../src/runtime/doofpi-fetch";

const d = new Doofpi();
// An output model gives the client its response type (without one it is `never`)
const local = d.routes({
  hello: d.endpointBuilder
    .model({ output: z.object({ message: z.string() }) })
    .read(() => ({ message: "hi" })),
});
const remote = d.routes({
  auth: {
    signin: d.endpointBuilder
      .model({ output: z.object({ ok: z.boolean() }) })
      .write(() => ({ ok: true })),
  },
});

declare module "../src/runtime/doofpi-client" {
  interface Register {
    localRoutes: typeof local;
    remoteRoutes: typeof remote;
    defaultFetch: "pfetch";
  }
}

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const assert = <_T extends true>() => {};

// Compile-time checks: `tsc` fails when one of them stops holding
export function typeChecks() {
  assert<Equal<RegisteredLocalRoutes, typeof local>>();
  assert<Equal<RegisteredRemoteRoutes, typeof remote>>();
  assert<IsAny<RegisteredLocalRoutes> extends false ? true : false>();
  assert<IsAny<RegisteredRemoteRoutes> extends false ? true : false>();

  assert<Equal<RoutesForMode<"lfetch">, typeof local>>();
  assert<Equal<RoutesForMode<"pfetch">, typeof remote>>();
  assert<Equal<RoutesForMode<"dfetch">, typeof remote>>();
  assert<Equal<RoutesForMode<"sfetch">, typeof remote>>();
  // No mode, or a mode that is not a single literal: the `defaultFetch` of the config (pfetch here)
  assert<Equal<RoutesForMode, typeof remote>>();
  assert<Equal<RoutesForMode<"lfetch" | "pfetch">, typeof remote>>();

  const byDefault = useDoofpi();
  assert<Equal<typeof byDefault, DoofpiClient<typeof remote>>>();
  const lfetch = useDoofpi({ mode: "lfetch" });
  assert<Equal<typeof lfetch, DoofpiClient<typeof local>>>();
  const pfetch = useDoofpi({ mode: "pfetch" });
  assert<Equal<typeof pfetch, DoofpiClient<typeof remote>>>();
  const explicit = useDoofpi<typeof local>();
  assert<Equal<typeof explicit, DoofpiClient<typeof local>>>();
  const explicitWithMode = useDoofpi<typeof local>({ mode: "lfetch" });
  assert<Equal<typeof explicitWithMode, DoofpiClient<typeof local>>>();

  void lfetch.hello.read();
  void pfetch.auth.signin.write();
  // @ts-expect-error the local routes have no `auth`
  void lfetch.auth;
  // @ts-expect-error the remote routes have no `hello`
  void pfetch.hello;
  // @ts-expect-error the default mode is pfetch, whose routes have no `hello`
  void byDefault.hello;

  useDoofpiFetch("a", (c) => c.hello.read(), { mode: "lfetch" });
  useDoofpiFetch("b", (c) => c.auth.signin.write(), { mode: "pfetch" });
  useDoofpiFetch("c", (c) => c.auth.signin.write());
  useDoofpiFetch("d", (c: DoofpiClient<typeof local>) => c.hello.read());
  useDoofpiFetch<{ message: string }, typeof local>("e", (c) => c.hello.read());
  // @ts-expect-error `auth` is not a local route
  useDoofpiFetch("f", (c) => c.auth.signin.write(), { mode: "lfetch" });
  // @ts-expect-error `hello` is not a remote route
  useDoofpiFetch("g", (c) => c.hello.read(), { mode: "pfetch" });
  // @ts-expect-error `hello` is not a remote route (default mode)
  useDoofpiFetch("h", (c) => c.hello.read());

  const local2 = useDoofpiFetch("i", (c) => c.hello.read(), { mode: "lfetch" });
  assert<Equal<typeof local2.data.value, { message: string } | undefined>>();
  const remote2 = useDoofpiFetch("j", (c) => c.auth.signin.write(), {
    mode: "pfetch",
  });
  assert<Equal<typeof remote2.data.value, { ok: boolean } | undefined>>();
  const viaDefault = useDoofpiFetch("k", (c) => c.auth.signin.write());
  assert<Equal<typeof viaDefault.data.value, { ok: boolean } | undefined>>();
}

describe("doofpi client routes types", () => {
  it("is checked at compile time", () => {
    expect(typeof typeChecks).toBe("function");
  });
});
