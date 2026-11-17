import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config";
import { startPlatformProxy } from "../src/vite/platform";

const project = () => {
  const root = mkdtempSync(path.join(tmpdir(), "noofpi-platform-"));
  writeFileSync(path.join(root, "package.json"), "{}");
  return root;
};

afterEach(() => vi.restoreAllMocks());

describe("startPlatformProxy", () => {
  it("does nothing for presets without Cloudflare bindings", async () => {
    const config = resolveConfig({ build: { preset: "node" } });
    expect(await startPlatformProxy(project(), config)).toBeUndefined();
  });

  it("warns and continues without bindings when wrangler is not installed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveConfig({ build: { preset: "cloudflare-worker" } });
    expect(await startPlatformProxy(project(), config)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
