import { applyCookies, createCookieJar, type CookieJar } from "../cookies";
import { buildCspHeader, generateNonce, injectNonce, usesNonce } from "../csp";
import { applyHead, resolveHead } from "../head";
import { injectPayload, type PayloadData } from "../payload";
import {
  isServerRendered,
  matchRouteRules,
  usesFetchMode,
} from "../route-rules";
import {
  applyRouteSecurity,
  applySecurityHeaders,
  isAllowedHost,
  isCrossSiteWrite,
  limitRequestBody,
} from "../security";
import { bindRequestCookies } from "./cookies";
import { proxyRequest } from "./proxy";
import { PROXY_PREFIX, SSR_OUTLET, type ServerModule } from "./types";

export interface HandlerOptions {
  /** Returns the generated server module (`virtual:noofpi/server`, or the built bundle in production) */
  load: () => Promise<ServerModule>;
  /** Returns the HTML shell for a page URL */
  getTemplate: (url: string) => Promise<string>;
  onError?: (error: unknown) => void;
}

export type Handler = (request: Request, env?: unknown) => Promise<Response>;

const isUnder = (pathname: string, root: string) =>
  pathname === root ||
  pathname.startsWith(root + ".") ||
  pathname.startsWith(root + "/");

/** The global security options with the ones of the `routeRules` matching the URL applied */
function routeSecurity(mod: ServerModule, url: URL) {
  const rules = mod.config.routeRules;
  return applyRouteSecurity(
    mod.config.security,
    rules && matchRouteRules(rules, url.pathname).security,
  );
}

/**: one web-standard `fetch(Request) -> Response` handler.
 * Order: proxy (pfetch) -> local doofpi API -> HTML (SSR render or SPA shell).
 */
export function createHandler(options: HandlerOptions): Handler {
  const reportError = (error: unknown) => {
    options.onError?.(error);
    if (!options.onError) console.error(error);
  };

  const respond = async (
    mod: ServerModule,
    request: Request,
    env: unknown,
    cookies: CookieJar,
  ): Promise<Response> => {
    const url = new URL(request.url);
    const { ssr, doofpi } = mod.config;
    const security = routeSecurity(mod, url);

    const isProxy =
      usesFetchMode(doofpi.fetch, mod.config.routeRules, "pfetch") &&
      url.pathname.startsWith(PROXY_PREFIX + "/");
    const isApi = !!mod.doofpi && isUnder(url.pathname, doofpi.root);
    if (
      security?.csrf &&
      (isProxy || isApi) &&
      isCrossSiteWrite(request, url, security.csrf)
    ) {
      return new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (isProxy) {
      return await proxyRequest(request, {
        base: doofpi.url!,
        root: doofpi.root,
        hook: mod.proxyHook,
      });
    }

    if (isApi) {
      return await mod.doofpi!.fetch(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    // Unknown file requests (favicon.ico, *.map...) are not pages
    if (/\.[a-z0-9]+$/i.test(url.pathname))
      return new Response("Not Found", { status: 404 });

    const template = await options.getTemplate(url.pathname + url.search);
    let html = "";
    let head = resolveHead(mod.config.head);
    let payload: PayloadData | undefined;
    let status = 200;
    if (
      mod.render &&
      isServerRendered(ssr, mod.config.routeRules, url.pathname)
    ) {
      const result = await mod.render(url.pathname + url.search, {
        origin: url.origin,
        cookie: request.headers.get("cookie") ?? undefined,
        cookies,
        acceptLanguage: request.headers.get("accept-language") ?? undefined,
        fetch: (input, init) => handler(new Request(input, init), env),
      });
      if (result.redirect)
        return new Response(null, {
          status: result.status,
          headers: { Location: result.redirect },
        });
      if (result.error !== undefined) reportError(result.error);
      html = result.html;
      head = result.head ?? head;
      payload = result.payload;
      status = result.status;
    }
    // The head goes into the template first, so rendered markup can never be mistaken for it
    let shell = applyHead(template, head);
    const { csp } = security ?? {};
    const nonce = usesNonce(csp) ? generateNonce() : undefined;
    // Only the shell gets nonces: scripts or styles inside rendered content must not be trusted
    if (nonce) shell = injectNonce(shell, nonce);
    let body = shell.replace(SSR_OUTLET, () => html);
    if (payload) body = injectPayload(body, payload);
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    if (csp) {
      const [name, value] = buildCspHeader(csp, nonce);
      headers.set(name, value);
    }
    return new Response(request.method === "HEAD" ? null : body, {
      status,
      headers,
    });
  };

  const handler: Handler = async (incoming, env) => {
    let request = incoming;
    let tooLarge = () => false;
    const payloadTooLarge = () =>
      new Response("Payload Too Large", { status: 413 });
    try {
      const mod = await options.load();
      const middleware = mod.middleware ?? [];
      const url = new URL(request.url);
      if (!isAllowedHost(url, mod.config.security?.allowedHosts))
        return new Response("Invalid Host", { status: 400 });
      const security = routeSecurity(mod, url);
      if (security?.bodyLimit) {
        const limited = limitRequestBody(request, security.bodyLimit);
        request = limited.request;
        tooLarge = limited.tooLarge;
      }
      const finish = (response: Response) =>
        applySecurityHeaders(
          response,
          security?.headers ?? {},
          url.protocol === "https:",
        );
      if (tooLarge()) return finish(payloadTooLarge());
      const cookies = createCookieJar({
        cookie: request.headers.get("cookie"),
        defaults: { secure: url.protocol === "https:" },
      });
      bindRequestCookies(request, cookies);
      const run = async (index: number): Promise<Response> => {
        const current = middleware[index];
        if (!current) return respond(mod, request, env, cookies);
        const response = await current({ request, url, env, cookies }, () =>
          run(index + 1),
        );
        if (!(response instanceof Response))
          throw new Error(
            "[noofpi] Server middleware must return a Response (return next() to continue).",
          );
        return response;
      };
      const response = applyCookies(await run(0), cookies);
      return finish(tooLarge() ? payloadTooLarge() : response);
    } catch (error) {
      if (tooLarge()) return payloadTooLarge();
      reportError(error);
      return new Response("Internal Server Error", { status: 500 });
    }
  };
  return handler;
}
