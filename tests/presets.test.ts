import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";
import { DOCKERIGNORE, dockerfile } from "../src/vite/docker";
import { finishPresetBuild } from "../src/vite/presets";
import {
  DEFAULT_COMPATIBILITY_DATE,
  stripJsonc,
  workerWranglerConfig,
} from "../src/vite/wrangler";

const docker = (options: Partial<Parameters<typeof dockerfile>[0]> = {}) =>
  dockerfile({
    bun: false,
    lock: true,
    port: 3000,
    image: undefined,
    healthcheck: "/",
    ...options,
  });

describe("dockerfile", () => {
  it("builds in two stages with production dependencies only", () => {
    const file = docker();
    expect(file.match(/^FROM /gm)).toHaveLength(2);
    expect(file).toContain("FROM node:22-alpine AS deps");
    expect(file).toContain("RUN npm ci --omit=dev");
    expect(file).toContain("COPY --from=deps /app/node_modules ./node_modules");
    expect(file).toContain("USER node");
    expect(file).toContain('CMD ["node", ".output/server/start.mjs"]');
    expect(docker({ lock: false })).toContain("RUN npm install --omit=dev");
  });

  it("installs with bun for a bun project", () => {
    const file = docker({ bun: true });
    expect(file).toContain("FROM oven/bun:1 AS deps");
    expect(file).toContain("RUN bun install --production --frozen-lockfile");
    expect(file).toContain("USER bun");
    expect(file).toContain('CMD ["bun", ".output/server/start.mjs"]');
    expect(docker({ bun: true, lock: false })).toContain(
      "RUN bun install --production\n",
    );
  });

  it("uses the configured image for both stages", () => {
    const file = docker({ image: "node:24-slim" });
    expect(file.match(/^FROM node:24-slim/gm)).toHaveLength(2);
    expect(file).not.toContain("alpine");
  });

  it("adds a healthcheck that requests the configured path on PORT", () => {
    const line = docker({ port: 8080, healthcheck: "/health" })
      .split("\n")
      .find((l) => l.startsWith("HEALTHCHECK"))!;
    const command = JSON.parse(
      line.slice(line.indexOf("CMD ") + 4),
    ) as string[];
    expect(command.slice(0, 2)).toEqual(["node", "-e"]);
    expect(command[2]).toContain("process.env.PORT||8080");
    expect(command[2]).toContain('"/health"');
    expect(docker({ healthcheck: false })).not.toContain("HEALTHCHECK");
  });
});

describe("DOCKERIGNORE", () => {
  it("only lets the build output and the install files into the context", () => {
    const lines = DOCKERIGNORE.split("\n");
    expect(lines[0]).toBe("*");
    expect(lines).toContain("!.output");
    expect(lines).toContain("!package.json");
    expect(lines).not.toContain("!.env");
  });
});

describe("build.docker config", () => {
  it("defaults and validates", () => {
    expect(resolveConfig().build.docker).toEqual({
      image: undefined,
      healthcheck: "/",
    });
    expect(
      resolveConfig({
        build: { docker: { image: " node:24 ", healthcheck: false } },
      }).build.docker,
    ).toEqual({ image: "node:24", healthcheck: false });
    expect(() =>
      resolveConfig({ build: { docker: { image: "node 24" } } }),
    ).toThrow("build.docker.image");
    for (const healthcheck of ["health", "//evil", '/a"b', "/a b"])
      expect(() =>
        resolveConfig({ build: { docker: { healthcheck } } }),
      ).toThrow("build.docker.healthcheck");
  });
});

describe("stripJsonc", () => {
  it("removes comments and trailing commas but not string content", () => {
    const text = `{
  // line
  "url": "https://example.com/*not a comment*/", /* block */
  "list": [1, 2,],
  "quote": "a \\" // b",
}`;
    expect(JSON.parse(stripJsonc(text))).toEqual({
      url: "https://example.com/*not a comment*/",
      list: [1, 2],
      quote: 'a " // b',
    });
  });
});

describe("workerWranglerConfig", () => {
  it("pins the compatibility date instead of using the build date", () => {
    expect(workerWranglerConfig("app")).toEqual({
      name: "app",
      compatibility_date: DEFAULT_COMPATIBILITY_DATE,
      compatibility_flags: ["nodejs_compat"],
      main: "server/index.mjs",
      assets: { directory: "public" },
    });
  });

  it("merges the project's config and keeps the build's own entry points", () => {
    const config = workerWranglerConfig("app", {
      $schema: "node_modules/wrangler/config-schema.json",
      name: "custom",
      main: "src/other.ts",
      compatibility_date: "2025-05-05",
      compatibility_flags: ["nodejs_als", "nodejs_compat"],
      kv_namespaces: [{ binding: "KV", id: "abc" }],
      vars: { A: "1" },
      build: { command: "noofpi build" },
      pages_build_output_dir: ".output/public",
      assets: { binding: "ASSETS", directory: "dist" },
    });
    expect(config).toEqual({
      name: "custom",
      compatibility_date: "2025-05-05",
      compatibility_flags: ["nodejs_compat", "nodejs_als"],
      kv_namespaces: [{ binding: "KV", id: "abc" }],
      vars: { A: "1" },
      main: "server/index.mjs",
      assets: { binding: "ASSETS", directory: "public" },
    });
  });
});

describe("finishPresetBuild cloudflare-worker", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "noofpi-preset-"));
    await mkdir(path.join(root, ".output/public"), { recursive: true });
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const written = async () =>
    JSON.parse(
      await readFile(path.join(root, ".output/wrangler.json"), "utf-8"),
    );
  const finish = () =>
    finishPresetBuild(
      root,
      resolveConfig({ build: { preset: "cloudflare-worker" } }),
      "cloudflare-worker",
    );

  it("is reproducible without a project wrangler config", async () => {
    await finish();
    expect((await written()).compatibility_date).toBe(
      DEFAULT_COMPATIBILITY_DATE,
    );
  });

  it("reads wrangler.jsonc of the project", async () => {
    await writeFile(
      path.join(root, "wrangler.jsonc"),
      `{ // mine\n "compatibility_date": "2025-09-09", "vars": { "A": "1", }, }`,
    );
    await finish();
    expect(await written()).toMatchObject({
      compatibility_date: "2025-09-09",
      vars: { A: "1" },
      main: "server/index.mjs",
    });
  });

  it("reports a wrangler config that is not valid JSON", async () => {
    await writeFile(path.join(root, "wrangler.json"), "{ nope");
    await expect(finish()).rejects.toThrow("Could not parse wrangler.json");
  });
});

describe("finishPresetBuild docker", () => {
  it("writes the Dockerfile and its .dockerignore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "noofpi-docker-"));
    try {
      await mkdir(path.join(root, ".output/public"), { recursive: true });
      await finishPresetBuild(
        root,
        resolveConfig({
          build: { preset: "docker", docker: { image: "node:24" } },
        }),
        "docker",
      );
      const file = await readFile(
        path.join(root, ".output/Dockerfile"),
        "utf-8",
      );
      expect(file).toContain("FROM node:24 AS deps");
      expect(
        existsSync(path.join(root, ".output/Dockerfile.dockerignore")),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
