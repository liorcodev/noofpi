import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InlineConfig } from "vite";
import { type BuildPreset } from "../build-preset";
import type { ResolvedNoofpiConfig } from "../config";
import { applyHead, resolveHead } from "../head";
import { SSR_OUTLET } from "../server/types";

export const OUTPUT_DIR = ".output";

/** The code every preset entry starts with: the handler for the built server module and HTML shell */
const HANDLER = `import { createHandler } from 'noofpi/server';
import * as mod from 'virtual:noofpi/server';
import template from 'virtual:noofpi/template';
const handler = createHandler({ load: async () => mod, getTemplate: async () => template });`;

const PORT_HOST = (port: number) =>
  `const port = Number(process.env.PORT ?? ${port});
const host = process.env.HOST ?? '0.0.0.0';`;

const PUBLIC_DIR = `const publicDir = fileURLToPath(new URL('../public', import.meta.url));`;

/** Code of `virtual:noofpi/entry`: the entry module of a preset's server build */
export function presetEntryCode(
  preset: BuildPreset,
  config: ResolvedNoofpiConfig,
): string {
  const { port } = config.devServer;
  switch (preset) {
    case "bun":
      return [
        `import { fileURLToPath } from 'node:url';`,
        `import { serveBun } from 'noofpi/server/bun';`,
        HANDLER,
        PUBLIC_DIR,
        PORT_HOST(port),
        `await serveBun({ publicDir, handler, port, host });`,
      ].join("\n");
    case "cloudflare-worker":
      return [
        HANDLER,
        `export default { fetch: (request, env) => handler(request, env) };`,
      ].join("\n");
    case "cloudflare-pages":
      return [
        HANDLER,
        // Pages serves static files through the ASSETS binding; everything else is a page or an API call
        `const isFile = (request) => (request.method === 'GET' || request.method === 'HEAD') && /\\.[a-z0-9]+$/i.test(new URL(request.url).pathname);`,
        `export default { fetch: (request, env) => isFile(request) && env.ASSETS ? env.ASSETS.fetch(request) : handler(request, env) };`,
      ].join("\n");
    default:
      return [
        `import { fileURLToPath } from 'node:url';`,
        `import { createNodeServer, listenNodeServer } from 'noofpi/server/node';`,
        HANDLER,
        PUBLIC_DIR,
        PORT_HOST(port),
        `await listenNodeServer(createNodeServer({ publicDir, handler }), port, host);`,
      ].join("\n");
  }
}

/** The built HTML shell, inlined into the server bundle (`virtual:noofpi/template`) */
export function readBuiltTemplate(root: string): string {
  const file = path.join(root, OUTPUT_DIR, "public/index.html");
  if (!existsSync(file))
    throw new Error("[noofpi] The client build is missing (no index.html).");
  return readFileSync(file, "utf-8");
}

/** Server build settings of a preset: entry points, output location and how dependencies are bundled */
export function serverBuildConfig(
  root: string,
  preset: BuildPreset,
): InlineConfig {
  const outDir = path.join(root, OUTPUT_DIR);
  switch (preset) {
    case "cloudflare-worker":
      return {
        ssr: { target: "webworker", noExternal: true },
        build: {
          ssr: true,
          outDir: path.join(outDir, "server"),
          emptyOutDir: true,
          rollupOptions: {
            input: "virtual:noofpi/entry",
            output: { entryFileNames: "index.mjs", inlineDynamicImports: true },
          },
        },
      };
    case "cloudflare-pages":
      return {
        ssr: { target: "webworker", noExternal: true },
        build: {
          ssr: true,
          // The Worker is added to the static files (the client build is already there)
          outDir: path.join(outDir, "public"),
          emptyOutDir: false,
          rollupOptions: {
            input: "virtual:noofpi/entry",
            output: {
              entryFileNames: "_worker.js",
              inlineDynamicImports: true,
            },
          },
        },
      };
    default:
      return {
        build: {
          ssr: true,
          outDir: path.join(outDir, "server"),
          emptyOutDir: true,
          rollupOptions: {
            // `index` is what `noofpi start` loads, `start` runs without the CLI
            input: {
              index: "virtual:noofpi/server",
              start: "virtual:noofpi/entry",
            },
            output: {
              entryFileNames: "[name].mjs",
              chunkFileNames: "assets/[name]-[hash].mjs",
            },
          },
        },
      };
  }
}

function readPackageName(root: string): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8"),
    ) as { name?: string };
    return pkg.name;
  } catch {
    return undefined;
  }
}

function workerName(root: string): string {
  const name = (readPackageName(root) ?? path.basename(root))
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "noofpi-app";
}

function dockerfile(root: string, port: number): string {
  const bun =
    existsSync(path.join(root, "bun.lock")) ||
    existsSync(path.join(root, "bun.lockb"));
  if (bun) {
    return `FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install${existsSync(path.join(root, "bun.lock")) ? " --frozen-lockfile" : ""}
COPY .output .output
USER bun
ENV NODE_ENV=production PORT=${port}
EXPOSE ${port}
CMD ["bun", ".output/server/start.mjs"]
`;
  }
  const lock = existsSync(path.join(root, "package-lock.json"));
  return `FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN ${lock ? "npm ci" : "npm install"}
COPY .output .output
USER node
ENV NODE_ENV=production PORT=${port}
EXPOSE ${port}
CMD ["node", ".output/server/start.mjs"]
`;
}

/** Writes what a preset needs next to the build (deploy config, Dockerfile) and removes what it must not serve */
export async function finishPresetBuild(
  root: string,
  config: ResolvedNoofpiConfig,
  preset: BuildPreset,
): Promise<string> {
  const outDir = path.join(root, OUTPUT_DIR);
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  switch (preset) {
    case "cloudflare-worker":
      // The shell is inlined in the Worker, as a file it would be served for `/` without rendering
      await rm(path.join(outDir, "public/index.html"), { force: true });
      await writeFile(
        path.join(outDir, "wrangler.json"),
        json({
          name: workerName(root),
          main: "server/index.mjs",
          compatibility_date: new Date().toISOString().slice(0, 10),
          compatibility_flags: ["nodejs_compat"],
          assets: { directory: "public" },
        }),
      );
      return "deploy with `wrangler deploy -c .output/wrangler.json`";
    case "cloudflare-pages":
      await rm(path.join(outDir, "public/index.html"), { force: true });
      await writeFile(
        path.join(outDir, "public/_routes.json"),
        json({ version: 1, include: ["/*"], exclude: ["/assets/*"] }),
      );
      return "deploy with `wrangler pages deploy .output/public`";
    case "github-pages": {
      // Static hosting has no server to render the shell, so the head defaults are baked in here
      const index = path.join(outDir, "public/index.html");
      const html = applyHead(
        readFileSync(index, "utf-8"),
        resolveHead(config.head),
      ).replace(SSR_OUTLET, () => "");
      await writeFile(index, html);
      // GitHub Pages serves 404.html for unknown paths, which lets the client router handle deep links
      await writeFile(path.join(outDir, "public/404.html"), html);
      await writeFile(path.join(outDir, "public/.nojekyll"), "");
      return "publish `.output/public` to GitHub Pages (set `vite.base` to `/<repo>/` for project sites)";
    }
    case "docker":
      await mkdir(outDir, { recursive: true });
      await writeFile(
        path.join(outDir, "Dockerfile"),
        dockerfile(root, config.devServer.port),
      );
      return "build with `docker build -f .output/Dockerfile -t my-app .`";
    case "bun":
      return "run with `bun .output/server/start.mjs`";
    default:
      return "run with `noofpi start` or `node .output/server/start.mjs`";
  }
}
