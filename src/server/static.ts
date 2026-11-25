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
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json",
};

/** Text-like files `noofpi build` precompresses (`.br` and `.gz` next to them) for the node, bun and docker presets */
export const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".txt",
  ".xml",
  ".map",
  ".ico",
]);

/** Precompressed variants in order of preference: file extension and `Content-Encoding` */
const ENCODINGS = [
  { encoding: "br", suffix: ".br" },
  { encoding: "gzip", suffix: ".gz" },
] as const;

/** Request headers, as `node:http` or `Object.fromEntries(request.headers)` provide them (lowercase names) */
export type StaticRequestHeaders = Record<
  string,
  string | string[] | undefined
>;

export interface StaticFile {
  /** 200 (whole file), 206 (`range`), 304 (not modified) or 416 (unsatisfiable range) */
  status: 200 | 206 | 304 | 416;
  /** What to read for the body: `null` for 304 and 416. `end` is inclusive. */
  body: { file: string; start?: number; end?: number } | null;
  /** Response headers (`Content-Type`, `Cache-Control`, `ETag`, `Content-Length`...) */
  headers: Record<string, string>;
}

function header(headers: StaticRequestHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

/** The q-value of each coding of an `Accept-Encoding` header (`*` included), 0 meaning refused */
function parseAcceptEncoding(value: string | undefined) {
  const accepted = new Map<string, number>();
  for (const part of value?.split(",") ?? []) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*(\d(?:\.\d{0,3})?)\s*$/.exec(param);
      if (match) q = Number(match[1]);
    }
    accepted.set(name.trim(), q);
  }
  return accepted;
}

/** The precompressed variant to serve, `null` for the file itself. Picks the preferred coding the client accepts and the build produced. */
async function pickEncoding(file: string, acceptEncoding: string | undefined) {
  const accepted = parseAcceptEncoding(acceptEncoding);
  if (!accepted.size) return null;
  const wildcard = accepted.get("*") ?? 0;
  for (const { encoding, suffix } of ENCODINGS) {
    if ((accepted.get(encoding) ?? wildcard) <= 0) continue;
    const info = await stat(file + suffix).catch(() => null);
    if (info?.isFile()) return { encoding, file: file + suffix, info };
  }
  return null;
}

function weakTag(tag: string) {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/** `If-None-Match` matches with the weak comparison: the client already has this version */
function matchesNoneMatch(value: string, etag: string) {
  if (value.trim() === "*") return true;
  return value.split(",").some((tag) => weakTag(tag.trim()) === etag);
}

const toSeconds = (ms: number) => Math.floor(ms / 1000);

/** Whether the client's cached copy is current, by `If-None-Match` or, without it, `If-Modified-Since` */
function isNotModified(
  headers: StaticRequestHeaders,
  etag: string,
  mtimeMs: number,
) {
  const noneMatch = header(headers, "if-none-match");
  if (noneMatch !== undefined) return matchesNoneMatch(noneMatch, etag);
  const since = Date.parse(header(headers, "if-modified-since") ?? "");
  return !Number.isNaN(since) && toSeconds(mtimeMs) <= toSeconds(since);
}

/** `If-Range` holds the range request only while the file is the version the client has (strong comparison) */
function ifRangeHolds(
  headers: StaticRequestHeaders,
  etag: string,
  mtimeMs: number,
) {
  const value = header(headers, "if-range")?.trim();
  if (!value) return true;
  if (value.startsWith('"') || value.startsWith("W/")) return value === etag;
  const date = Date.parse(value);
  return !Number.isNaN(date) && toSeconds(date) === toSeconds(mtimeMs);
}

/**
 * The byte range of a single `bytes=` range header: `null` when it is absent, malformed or a multi-range
 * (the whole file is served then), `"unsatisfiable"` when it lies beyond the file.
 */
function parseRange(value: string | undefined, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value?.trim() ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (match[2] && Number(match[2]) < start) return null;
  }
  return start >= size ? "unsatisfiable" : { start, end };
}

/**
 * Finds the file of `dir` a GET / HEAD request is for, or `null` when it is not a static file request.
 * Negotiates the precompressed variants (`.br`, `.gz`), answers conditional requests with 304 and single byte ranges with 206.
 */
export async function resolveStaticFile(
  dir: string,
  method: string,
  rawPath: string,
  requestHeaders: StaticRequestHeaders = {},
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

  const extension = path.extname(file).toLowerCase();
  const compressible = COMPRESSIBLE_EXTENSIONS.has(extension);
  const range = header(requestHeaders, "range");
  // A range is of the file as it is, so a range request is never answered with a compressed variant
  const variant =
    compressible && range === undefined
      ? await pickEncoding(file, header(requestHeaders, "accept-encoding"))
      : null;
  const served = variant?.info ?? info;
  const etag = `"${served.size.toString(16)}-${Math.floor(served.mtimeMs).toString(16)}"`;

  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Content-Type": MIME[extension] ?? "application/octet-stream",
    "Cache-Control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    ETag: etag,
    "Last-Modified": served.mtime.toUTCString(),
    "Accept-Ranges": "bytes",
  };
  if (compressible) headers.Vary = "Accept-Encoding";
  if (variant) headers["Content-Encoding"] = variant.encoding;

  if (isNotModified(requestHeaders, etag, served.mtimeMs)) {
    delete headers["Content-Type"];
    return { status: 304, body: null, headers };
  }

  const bytes =
    range !== undefined && ifRangeHolds(requestHeaders, etag, served.mtimeMs)
      ? parseRange(range, served.size)
      : null;
  if (bytes === "unsatisfiable") {
    headers["Content-Range"] = `bytes */${served.size}`;
    headers["Content-Length"] = "0";
    return { status: 416, body: null, headers };
  }
  if (bytes) {
    headers["Content-Range"] =
      `bytes ${bytes.start}-${bytes.end}/${served.size}`;
    headers["Content-Length"] = String(bytes.end - bytes.start + 1);
    return {
      status: 206,
      body: { file: variant?.file ?? file, ...bytes },
      headers,
    };
  }
  headers["Content-Length"] = String(served.size);
  return {
    status: 200,
    body: { file: variant?.file ?? file },
    headers,
  };
}
