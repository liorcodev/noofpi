import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  resolveConfig,
  type NoofpiConfig,
  type ResolvedNoofpiConfig,
} from "./config";

const CONFIG_FILES = [
  "noofpi.config.ts",
  "noofpi.config.mts",
  "noofpi.config.js",
  "noofpi.config.mjs",
];

export async function loadConfig(root: string): Promise<ResolvedNoofpiConfig> {
  const file = CONFIG_FILES.map((name) => path.join(root, name)).find(
    existsSync,
  );
  if (!file) return resolveConfig({});
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const loaded = await jiti.import<NoofpiConfig | { default: NoofpiConfig }>(
    file,
  );
  const config = (
    loaded && "default" in loaded ? loaded.default : loaded
  ) as NoofpiConfig;
  return resolveConfig(config);
}
