import type { CookieJar } from "../cookies";

// A registered symbol keeps this working when server code and the framework hold separate copies of this module
// (user code is bundled into the server build, the handler may not be)
const JAR = Symbol.for("noofpi.request-cookies");

type WithJar = Request & { [JAR]?: CookieJar };

export function bindRequestCookies(request: Request, jar: CookieJar): void {
  (request as WithJar)[JAR] = jar;
}

/**
 * The cookies of a request the noofpi server is handling: read what the browser sent, `set` / `remove` cookies that
 * go out with the response. Pass the `Request` you were given (a doofpi endpoint's `req`, a server middleware's
 * `request`); a copy of it is not known to the server.
 */
export function getRequestCookies(request: Request): CookieJar {
  const jar = (request as WithJar)[JAR];
  if (!jar)
    throw new Error(
      "[noofpi] getRequestCookies() needs the original Request of a request handled by the noofpi server",
    );
  return jar;
}
