import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import type { BuildPreset } from "../build-preset";
import type { ResolvedNoofpiConfig } from "../config";
import { usesFetchMode } from "../route-rules";
import { resolveFonts } from "../fonts";
import { createViteConfig } from "./config";
import { finishPresetBuild, OUTPUT_DIR } from "./presets";

export async function buildApp(
  root: string,
  resolved: ResolvedNoofpiConfig,
  preset: BuildPreset = resolved.build.preset,
): Promise<void> {
  const config = { ...resolved, build: { ...resolved.build, preset } };
  const isStatic = preset === "github-pages";
  if (isStatic) {
    // Static hosting only serves files: no server rendering and no local or proxied doofpi API
    const { fetch } = config.doofpi;
    for (const mode of ["lfetch", "pfetch", "sfetch"] as const)
      if (usesFetchMode(fetch, config.routeRules, mode))
        throw new Error(
          `[noofpi] The github-pages preset has no server, so doofpi fetch "${mode}" cannot be used (use "dfetch")`,
        );
    config.ssr = false;
  }
  const fonts = await resolveFonts(root, config);
  // Files of another preset's earlier build (wrangler.json, Dockerfile, server/) must not linger
  await rm(path.join(root, OUTPUT_DIR), { recursive: true, force: true });
  console.log(`\nnoofpi: building client (preset: ${preset})...`);
  await build(createViteConfig(root, config, "client", fonts));
  if (!isStatic) {
    console.log("\nnoofpi: building server...");
    await build(createViteConfig(root, config, "server", fonts));
  }
  const next = await finishPresetBuild(root, config, preset);
  console.log(`\nnoofpi: build complete -> .output/ (${next})\n`);
}
