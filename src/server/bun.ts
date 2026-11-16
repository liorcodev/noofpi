import type { Handler } from "./handler";
import { resolveStaticFile } from "./static";

interface BunRuntime {
  serve(options: {
    port: number;
    hostname: string;
    fetch: (request: Request) => Promise<Response>;
  }): unknown;
  file(path: string): Blob;
}

/** Serves a handler with `Bun.serve`: static files of `publicDir` first, then the handler. */
export async function serveBun(options: {
  publicDir: string;
  handler: Handler;
  port: number;
  host: string;
}): Promise<void> {
  const bun = (globalThis as { Bun?: BunRuntime }).Bun;
  if (!bun)
    throw new Error("[noofpi] The bun preset has to run with bun (`bun ...`).");
  bun.serve({
    port: options.port,
    hostname: options.host,
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const found = await resolveStaticFile(
          options.publicDir,
          request.method,
          url.pathname,
        );
        if (found) {
          return new Response(
            request.method === "HEAD" ? null : bun.file(found.file),
            {
              headers: {
                ...found.headers,
                "Content-Length": String(found.size),
              },
            },
          );
        }
        return await options.handler(request);
      } catch (error) {
        console.error(error);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });
  console.log(
    `\n  noofpi server running at http://${options.host === "0.0.0.0" ? "localhost" : options.host}:${options.port}\n`,
  );
}
