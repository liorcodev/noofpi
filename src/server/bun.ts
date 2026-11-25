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
          Object.fromEntries(request.headers),
        );
        if (found) {
          let body: Blob | null = null;
          if (request.method !== "HEAD" && found.body) {
            const { file, start, end } = found.body;
            body = bun.file(file);
            if (start !== undefined && end !== undefined)
              body = body.slice(start, end + 1);
          }
          return new Response(body, {
            status: found.status,
            headers: found.headers,
          });
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
