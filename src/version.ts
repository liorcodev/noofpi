import { readFileSync } from "node:fs";

/** The version of the installed noofpi package, an empty string when it can not be read */
export function packageVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf-8")).version as string;
  } catch {
    return "";
  }
}
