import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "server/index": "src/server/index.ts",
    "server/node": "src/server/node.ts",
    "server/bun": "src/server/bun.ts",
    "runtime/index": "src/runtime/index.ts",
    "runtime/routes": "src/runtime/routes.ts",
    "runtime/default-app": "src/runtime/default-app.ts",
    "runtime/entry-client": "src/runtime/entry-client.ts",
    "runtime/entry-server": "src/runtime/entry-server.ts",
    "runtime/silent-diagnostics": "src/runtime/silent-diagnostics.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  dts: {
    entry: [
      "src/index.ts",
      "src/server/index.ts",
      "src/server/node.ts",
      "src/server/bun.ts",
      "src/runtime/index.ts",
      "src/runtime/routes.ts",
      "src/runtime/default-app.ts",
      "src/runtime/entry-client.ts",
      "src/runtime/entry-server.ts",
      "src/runtime/silent-diagnostics.ts",
    ],
  },
  clean: true,
  splitting: true,
  // Virtual modules are provided by the noofpi vite plugin
  external: [/^virtual:noofpi\//],
});
