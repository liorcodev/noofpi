import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FontProviderContext } from "../types";

const TIMEOUT_MS = 30_000;

function cachePath(context: FontProviderContext, url: string, ext: string) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  return path.join(context.cacheDir, `${hash}${ext}`);
}

async function download(
  context: FontProviderContext,
  url: string,
  file: string,
  headers?: Record<string, string>,
): Promise<void> {
  const response = await context.fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} (${url})`);
  }
  await mkdir(context.cacheDir, { recursive: true });
  // Write-then-rename so an interrupted download never leaves a truncated cache entry
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, Buffer.from(await response.arrayBuffer()));
  await rename(temp, file);
}

const inflight = new Map<string, Promise<void>>();

/** Downloads `url` once; later runs (and offline runs) reuse the cached copy */
export async function cachedFile(
  context: FontProviderContext,
  url: string,
  ext: string,
  headers?: Record<string, string>,
): Promise<string> {
  const file = cachePath(context, url, ext);
  if (existsSync(file)) return file;
  // Several faces (weights, subsets) often point at the same file, so share the running download
  let pending = inflight.get(file);
  if (!pending) {
    pending = download(context, url, file, headers).finally(() =>
      inflight.delete(file),
    );
    inflight.set(file, pending);
  }
  await pending;
  return file;
}

export async function cachedText(
  context: FontProviderContext,
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  return readFile(await cachedFile(context, url, ".css", headers), "utf-8");
}
