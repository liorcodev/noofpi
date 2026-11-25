import { createReadStream } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { pipeline, Readable } from "node:stream";
import type { Handler } from "./handler";
import { resolveStaticFile } from "./static";

export function toWebRequest(req: IncomingMessage): Request {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ?? "http";
  // The target is appended to the origin (not resolved against it) so a `//host/path` target cannot replace the host
  const target = req.url?.startsWith("/") ? req.url : "/";
  const url = new URL(`${proto}://${req.headers.host ?? "localhost"}${target}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

export async function sendWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key !== "set-cookie") res.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  if (!response.body) {
    res.end();
    return;
  }
  // `pipeline` throws for a response whose client already disconnected
  if (res.destroyed) {
    await response.body.cancel().catch(ignoreStreamError);
    return;
  }
  pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    res,
    ignoreStreamError,
  );
}

// `pipeline` destroys both streams on failure; the client just sees the connection close
const ignoreStreamError = () => {};

/** Serves files from `dir`. Returns `false` when the request is not a static file. */
export async function serveStatic(
  dir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const found = await resolveStaticFile(
    dir,
    req.method ?? "GET",
    req.url ?? "/",
    req.headers,
  );
  if (!found) return false;
  res.statusCode = found.status;
  for (const [name, value] of Object.entries(found.headers))
    res.setHeader(name, value);
  if (req.method === "HEAD" || !found.body || res.destroyed) res.end();
  else {
    const { file, start, end } = found.body;
    pipeline(createReadStream(file, { start, end }), res, ignoreStreamError);
  }
  return true;
}

/** A node http server for a handler: static files of `publicDir` first, then the handler. Not listening yet. */
export function createNodeServer(options: {
  publicDir: string;
  handler: Handler;
}): Server {
  return createServer(async (req, res) => {
    try {
      if (await serveStatic(options.publicDir, req, res)) return;
      await sendWebResponse(res, await options.handler(toWebRequest(req)));
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
}

/** Starts `createNodeServer` and logs the address. `host` `0.0.0.0` is shown as `localhost`. */
export async function listenNodeServer(
  server: Server,
  port: number,
  host: string,
): Promise<Server> {
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  console.log(
    `\n  noofpi server running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}\n`,
  );
  return server;
}
