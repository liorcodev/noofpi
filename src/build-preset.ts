export const BUILD_PRESETS = [
  "node",
  "bun",
  "docker",
  "cloudflare-worker",
  "cloudflare-pages",
  "github-pages",
] as const;

/**
 * - `node`: `.output/` runs with `noofpi start` or `node .output/server/start.mjs`
 * - `bun`: like `node`, served with `Bun.serve` (`bun .output/server/start.mjs`)
 * - `docker`: like `node`, plus `.output/Dockerfile`
 * - `cloudflare-worker`: one bundled Worker (`server/index.mjs`) with static assets, plus `wrangler.json`
 * - `cloudflare-pages`: `public/` with a bundled `_worker.js`, deployable with `wrangler pages deploy`
 * - `github-pages`: static client-only SPA in `public/` (no server): `index.html`, a `404.html` fallback and `.nojekyll`
 */
export type BuildPreset = (typeof BUILD_PRESETS)[number];

export function isCloudflarePreset(preset: BuildPreset): boolean {
  return preset === "cloudflare-worker" || preset === "cloudflare-pages";
}

export function assertBuildPreset(value: unknown, source: string): BuildPreset {
  if (!BUILD_PRESETS.includes(value as BuildPreset)) {
    throw new Error(
      `[noofpi] ${source} must be one of ${BUILD_PRESETS.join(", ")} (got "${String(value)}")`,
    );
  }
  return value as BuildPreset;
}
