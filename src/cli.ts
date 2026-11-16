import path from "node:path";
import { assertBuildPreset, BUILD_PRESETS } from "./build-preset";
import { loadConfig } from "./load-config";

const USAGE = `noofpi <command> [options]

Commands:
  dev     Start the dev server with live reload
  build   Build for production into .output/
  start   Run the production build

Options:
  --root <dir>      Project root (default: current directory)
  --port <port>     Server port
  --host <host>     Server host
  --preset <name>   Build target: ${BUILD_PRESETS.join(" | ")} (default: build.preset or node)`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

// Copies every .env* value into process.env; variables already set in the shell win.
async function loadEnvFiles(root: string, mode: string) {
  const { loadEnv } = await import("vite");
  const env = loadEnv(mode, root, "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const root = path.resolve(option(args, "--root") ?? process.cwd());
  const portArg = option(args, "--port");
  const overrides = {
    port: portArg ? Number(portArg) : undefined,
    host: option(args, "--host"),
  };

  if (command !== "dev" && command !== "build" && command !== "start") {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }

  process.env.NODE_ENV ??= command === "dev" ? "development" : "production";
  await loadEnvFiles(root, command === "dev" ? "development" : "production");
  const config = await loadConfig(root);

  if (command === "dev") {
    const { startDev } = await import("./vite/dev");
    await startDev(root, config, overrides);
  } else if (command === "build") {
    const { buildApp } = await import("./vite/build");
    const preset = option(args, "--preset");
    await buildApp(
      root,
      config,
      preset ? assertBuildPreset(preset, "--preset") : undefined,
    );
  } else {
    const { startProd } = await import("./vite/start");
    await startProd(root, config, overrides);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
