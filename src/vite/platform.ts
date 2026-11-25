import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isCloudflarePreset } from "../build-preset";
import type { ResolvedNoofpiConfig } from "../config";

export const WRANGLER_CONFIGS = [
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
];

export interface PlatformProxy {
  env: unknown;
  dispose: () => Promise<void>;
}

type GetPlatformProxy = (options: {
  configPath?: string;
}) => Promise<PlatformProxy>;

/**
 * Local Cloudflare bindings (vars, KV, D1, R2, ...) for `noofpi dev`, read from the project's
 * wrangler config. Only for the Cloudflare presets, and only when `wrangler` is installed.
 */
export async function startPlatformProxy(
  root: string,
  config: ResolvedNoofpiConfig,
): Promise<PlatformProxy | undefined> {
  if (!isCloudflarePreset(config.build.preset)) return undefined;

  let entry: string;
  try {
    entry = createRequire(path.join(root, "package.json")).resolve("wrangler");
  } catch {
    console.warn(
      "[noofpi] Cloudflare bindings are not available in dev: install wrangler (`wrangler` devDependency)",
    );
    return undefined;
  }

  const { getPlatformProxy } = (await import(pathToFileURL(entry).href)) as {
    getPlatformProxy: GetPlatformProxy;
  };
  const configPath = WRANGLER_CONFIGS.map((file) => path.join(root, file)).find(
    existsSync,
  );
  return getPlatformProxy({ configPath });
}
