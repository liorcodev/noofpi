import { describe, expect, it, vi } from "vitest";
import {
  createConsoleReporter,
  defineDiagnostics,
} from "../src/runtime/silent-diagnostics";

describe("silent diagnostics", () => {
  it("reports nothing to the console", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const diagnostics = defineDiagnostics({
      reporters: [createConsoleReporter()],
    }) as unknown as Record<string, (params?: object) => Error>;

    expect(diagnostics.VUE_ROUTER_R0004!({ path: "/nope" })).toBeInstanceOf(
      Error,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
