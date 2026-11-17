import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { createServer as createViteServer, normalizePath } from "vite";
import { localUrl, printBanner } from "../banner";
import type { ResolvedNoofpiConfig } from "../config";
import { bindShortcuts } from "../shortcuts";
import { createHandler } from "../server/handler";
import { sendWebResponse, toWebRequest } from "../server/node";
import type { ServerModule } from "../server/types";
import { resolveFonts } from "../fonts";
import { createViteConfig } from "./config";
import { DEV_ENTRY, resolveCss } from "./plugin";
import { startPlatformProxy } from "./platform";
import { htmlTemplate } from "./template";

export async function startDev(
  root: string,
  config: ResolvedNoofpiConfig,
  overrides: { port?: number; host?: string },
) {
  const startedAt = performance.now();
  const port = overrides.port ?? config.devServer.port;
  const host = overrides.host ?? config.devServer.host;
  const httpServer = createHttpServer();
  const fonts = await resolveFonts(root, config);

  const vite = await createViteServer(
    createViteConfig(
      root,
      {
        ...config,
        vite: {
          ...config.vite,
          server: { middlewareMode: true, hmr: { server: httpServer } },
        },
      },
      "dev",
      fonts,
    ),
  );

  // In dev, CSS is otherwise injected by the client entry, so the server HTML would flash unstyled.
  // `?direct` makes vite serve the processed CSS itself instead of a JS module.
  const stylesheets = resolveCss(root, config, fonts).map((file) => {
    const relative = path.relative(root, file);
    const outside = relative.startsWith("..") || path.isAbsolute(relative);
    const url = outside
      ? "/@fs/" + normalizePath(file)
      : "/" + normalizePath(relative);
    return url + "?direct";
  });

  const platform = await startPlatformProxy(root, config);

  const handler = createHandler({
    load: () =>
      vite.ssrLoadModule("virtual:noofpi/server") as Promise<ServerModule>,
    getTemplate: (url) =>
      vite.transformIndexHtml(url, htmlTemplate(DEV_ENTRY, stylesheets)),
    onError: (error) => {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      console.error(error);
    },
  });

  httpServer.on("request", (req, res) => {
    // Vite serves modules, assets and HMR; everything else is the noofpi server
    vite.middlewares(req, res, () => {
      handler(toWebRequest(req), platform?.env).then(
        (response) => sendWebResponse(res, response),
        (error) => {
          console.error(error);
          res.statusCode = 500;
          res.end("Internal Server Error");
        },
      );
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  // Transforming the app (Tailwind, SSR module graph) can take seconds when cold, so start before the first request.
  // Failures are left to surface on the real request.
  vite.ssrLoadModule("virtual:noofpi/server").catch(() => {});
  for (const url of stylesheets) vite.warmupRequest(url).catch(() => {});
  const close = () =>
    Promise.all([vite.close(), platform?.dispose()]).then(() => {
      httpServer.closeAllConnections();
      httpServer.close();
    });
  const shortcuts = bindShortcuts({ url: localUrl(host, port), close });
  printBanner({ mode: "development", host, port, startedAt, shortcuts });
  return { vite, httpServer, close };
}
