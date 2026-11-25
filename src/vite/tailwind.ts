import type { Plugin } from "vite";
import { importOptional } from "../optional";

/** The Tailwind CSS (v4) vite plugin, loaded only when `tailwind` is enabled so the packages stay optional */
export async function tailwindPlugin(): Promise<Plugin[]> {
  const { default: tailwindcss } = await importOptional(
    () => import("@tailwindcss/vite"),
    ["tailwindcss", "@tailwindcss/vite"],
    "`tailwind: true`",
  );
  return tailwindcss();
}
