import { stat } from "node:fs/promises";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export interface StaticFile {
  file: string;
  size: number;
  /** Response headers of the file (`Content-Type`, `Cache-Control`...) */
  headers: Record<string, string>;
}

/** Finds the file of `dir` a GET / HEAD request is for, or `null` when it is not a static file request. */
export async function resolveStaticFile(
  dir: string,
  method: string,
  rawPath: string,
): Promise<StaticFile | null> {
  if (method !== "GET" && method !== "HEAD") return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(rawPath, "http://localhost").pathname,
    );
  } catch {
    return null;
  }
  const file = path.join(dir, pathname);
  if (!file.startsWith(dir + path.sep) || path.basename(file) === "index.html")
    return null;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;

  return {
    file,
    size: info.size,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Content-Type":
        MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  };
}
