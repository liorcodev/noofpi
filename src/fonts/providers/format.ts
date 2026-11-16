import path from "node:path";

const FORMATS: Record<string, string> = {
  ".woff2": "woff2",
  ".woff": "woff",
  ".ttf": "truetype",
  ".otf": "opentype",
};

export function formatOf(file: string): string | undefined {
  return FORMATS[path.extname(file).toLowerCase()];
}
