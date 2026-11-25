import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { localUrl, printBanner } from "../banner";
import type { ResolvedNoofpiConfig } from "../config";
import { createHandler } from "../server/handler";
import { sendWebResponse, serveStatic, toWebRequest } from "../server/node";
import { openBrowser } from "../shortcuts";
import type { ServerModule } from "../server/types";
import { OUTPUT_DIR } from "./config";

export async function startProd(
  root: string,
  config: ResolvedNoofpiConfig,
  overrides: { port?: number; host?: string; open?: boolean },
) {
  const startedAt = performance.now();
  const outDir = path.join(root, OUTPUT_DIR);
  const serverEntry = path.join(outDir, "server/index.mjs");
  const publicDir = path.join(outDir, "public");
  if (!existsSync(serverEntry))
    throw new Error("[noofpi] No build found. Run `noofpi build` first.");

  const mod = (await import(pathToFileURL(serverEntry).href)) as ServerModule;
  const template = await readFile(path.join(publicDir, "index.html"), "utf-8");
  const handler = createHandler({
    load: async () => mod,
    getTemplate: async () => template,
  });

  const port =
    overrides.port ?? Number(process.env.PORT ?? config.devServer.port);
  const host = overrides.host ?? process.env.HOST ?? "0.0.0.0";
  const server = createServer(async (req, res) => {
    try {
      if (await serveStatic(publicDir, req, res)) return;
      await sendWebResponse(res, await handler(toWebRequest(req)));
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  printBanner({ mode: "production", host, port, startedAt });
  if (overrides.open) openBrowser(localUrl(host, port));
  return server;
}
