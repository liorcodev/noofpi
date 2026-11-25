import path from "node:path";
import { assertBuildPreset, BUILD_PRESETS } from "./build-preset";
import { CliUsageError, parseCliArgs, type Command } from "./cli-args";
import { loadConfig } from "./load-config";
import { packageVersion } from "./version";

const USAGE = `noofpi <command> [options]

Commands:
  dev         Start the dev server with live reload
  build       Build for production into .output/
  start       Run the production build
  preview     Build, then run the production build
  prepare     Generate the .noofpi/ type declarations (for a postinstall script)
  typecheck   Run prepare, then vue-tsc --noEmit (extra arguments go to vue-tsc after --)

Options:
  --root <dir>      Project root (default: current directory)
  --port <port>     Server port (dev, start, preview)
  --host <host>     Server host (dev, start, preview)
  --open            Open the browser once the server is ready (dev, start, preview)
  --preset <name>   Build target: ${BUILD_PRESETS.join(" | ")} (default: build.preset or node)
                    preview needs a preset that \`noofpi start\` can run: node | bun | docker
  -h, --help        Show this help
  -v, --version     Show the noofpi version`;

const PREVIEW_PRESETS = ["node", "bun", "docker"];

// Copies every .env* value into process.env; variables already set in the shell win.
async function loadEnvFiles(root: string, mode: string) {
  const { loadEnv } = await import("vite");
  const env = loadEnv(mode, root, "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }
}

const isDevelopment = (command: Command) =>
  command === "dev" || command === "prepare" || command === "typecheck";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.version) {
    console.log(packageVersion());
    return;
  }
  const { command } = args;
  if (args.help || !command) {
    console.log(USAGE);
    return;
  }

  const root = path.resolve(args.root ?? process.cwd());
  const overrides = { port: args.port, host: args.host, open: args.open };
  const mode = isDevelopment(command) ? "development" : "production";

  process.env.NODE_ENV ??= mode;
  await loadEnvFiles(root, mode);
  const config = await loadConfig(root);

  if (command === "dev") {
    const { startDev } = await import("./vite/dev");
    await startDev(root, config, overrides);
  } else if (command === "build" || command === "preview") {
    const preset = args.preset
      ? assertBuildPreset(args.preset, "--preset")
      : undefined;
    if (command === "preview") {
      const target = preset ?? config.build.preset;
      if (!PREVIEW_PRESETS.includes(target))
        throw new Error(
          `[noofpi] preview can not run the "${target}" preset (use ${PREVIEW_PRESETS.join(" | ")}, or build it and serve .output/ with its own tooling)`,
        );
    }
    const { buildApp } = await import("./vite/build");
    await buildApp(root, config, preset);
    if (command === "preview") {
      const { startProd } = await import("./vite/start");
      await startProd(root, config, overrides);
    }
  } else if (command === "start") {
    const { startProd } = await import("./vite/start");
    await startProd(root, config, overrides);
  } else {
    const { prepareApp } = await import("./vite/prepare");
    await prepareApp(root, config);
    if (command === "prepare") {
      console.log("noofpi: generated .noofpi/");
    } else {
      const { runTypecheck } = await import("./vite/typecheck");
      process.exit(await runTypecheck(root, args.rest));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof CliUsageError)
    console.error("Run `noofpi --help` for usage.");
  process.exit(1);
});
