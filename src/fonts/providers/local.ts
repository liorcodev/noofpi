import { existsSync } from "node:fs";
import path from "node:path";
import type { FontProvider } from "../types";
import { formatOf } from "./format";

export const localProvider: FontProvider = {
  async resolve(family, { root }) {
    return family.files.map((file) => {
      // Root-relative ("/app/fonts/a.woff2") and relative ("app/fonts/a.woff2") both mean "inside the project"
      const full = path.resolve(root, file.src.replace(/^[\\/]+/, ""));
      const format = formatOf(full);
      if (!format) {
        throw new Error(
          `[noofpi] Local font "${family.name}": unsupported file type "${file.src}" (use woff2, woff, ttf or otf)`,
        );
      }
      if (!existsSync(full)) {
        throw new Error(
          `[noofpi] Local font "${family.name}": file not found "${file.src}" (relative to ${root})`,
        );
      }
      return {
        weight: file.weight,
        style: file.style,
        sources: [{ file: full, format }],
      };
    });
  },
};
