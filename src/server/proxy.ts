import { PROXY_PREFIX, type ProxyHook } from "./types";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "content-type",
  "if-none-match",
  "if-modified-since",
  "range",
];
const DROPPED_RESPONSE_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
];

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Resolves a proxied path to a URL on the remote API, or `null` when it is not allowed */
export function resolveProxyTarget(
  pathname: string,
  search: string,
  base: string,
  root: string,
): URL | null {
  if (!pathname.startsWith(PROXY_PREFIX + "/")) return null;
  const rest = pathname.slice(PROXY_PREFIX.length);
  let target: URL;
  try {
    target = new URL(rest + search, base);
  } catch {
    return null;
  }
  const afterRoot = target.pathname.charAt(root.length);
  const insideRoot =
    target.pathname.startsWith(root) &&
    (afterRoot === "" || afterRoot === "." || afterRoot === "/");
  // Only ever talk to the configured API, and only below its doofpi root (never an open proxy)
  return target.origin === new URL(base).origin && insideRoot ? target : null;
}

export async function proxyRequest(
  request: Request,
  options: { base: string; root: string; hook?: ProxyHook },
): Promise<Response> {
  const url = new URL(request.url);
  const target = resolveProxyTarget(
    url.pathname,
    url.search,
    options.base,
    options.root,
  );
  if (!target) return json(404, "Not found");

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const hooked = await options.hook?.({ request, headers, target });
  if (hooked instanceof Response) return hooked;

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      // Body is streamed through untouched (binary uploads and JSON alike)
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return json(502, "Bad gateway");
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
