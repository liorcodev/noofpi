export { createHandler } from "./handler";
export type { Handler, HandlerOptions } from "./handler";
export { proxyRequest, resolveProxyTarget } from "./proxy";
export { getRequestCookies } from "./cookies";
export {
  booleanCodec,
  defineCookie,
  enumCodec,
  jsonCodec,
  numberCodec,
  stringCodec,
} from "../cookies";
export type {
  CookieCodec,
  CookieDefinition,
  CookieJar,
  CookieOptions,
} from "../cookies";
export {
  FORM_ERROR_KEY,
  errorsFromFailure,
  issuesToErrors,
  validate,
} from "../validation";
export type {
  FormErrors,
  FormSchema,
  InferSchema,
  ValidationIssue,
  ValidationResult,
} from "../validation";
export type { PayloadData } from "../payload";
export type { ResolvedSecurity } from "../security";
export { PROXY_PREFIX } from "./types";
import type { ServerMiddleware } from "./types";
export type { ResolvedHead } from "../head";
export type {
  ProxyHook,
  ServerMiddleware,
  ServerMiddlewareContext,
  ServerModule,
  ServerConfig,
  RenderContext,
  RenderResult,
} from "./types";

/** Typing helper for `server/middleware/*.ts` */
export function defineServerMiddleware(
  middleware: ServerMiddleware,
): ServerMiddleware {
  return middleware;
}
