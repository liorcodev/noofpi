import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { COMPRESSIBLE_EXTENSIONS } from "../server/static";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Smaller files are not worth a second file and a negotiation */
const MIN_SIZE = 1024;

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Writes a `.br` and a `.gz` file next to each compressible file of `dir` (the static server answers
 * `Accept-Encoding` with them). A variant that is not smaller than the original is not written.
 */
export async function precompressDir(dir: string): Promise<void> {
  const files = (await listFiles(dir)).filter(
    (file) =>
      COMPRESSIBLE_EXTENSIONS.has(path.extname(file).toLowerCase()) &&
      // The shell is inlined in the server bundle and never served as a file
      path.basename(file) !== "index.html",
  );
  await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file);
      if (content.length < MIN_SIZE) return;
      const [br, gz] = await Promise.all([
        brotli(content, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
          },
        }),
        gzipAsync(content, { level: constants.Z_BEST_COMPRESSION }),
      ]);
      await Promise.all([
        br.length < content.length ? writeFile(`${file}.br`, br) : undefined,
        gz.length < content.length ? writeFile(`${file}.gz`, gz) : undefined,
      ]);
    }),
  );
}
