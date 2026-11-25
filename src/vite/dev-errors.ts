import { AsyncLocalStorage } from "node:async_hooks";
import {
  devErrorPage,
  serializeDevErrors,
  toDevError,
  type DevError,
} from "../dev-errors";

const scope = new AsyncLocalStorage<DevError[]>();

/** Runs `run` so errors the handler reports (`recordDevError`) are collected for this request */
export function collectDevErrors<T>(
  run: () => Promise<T>,
): Promise<{ result: T; errors: DevError[] }> {
  const errors: DevError[] = [];
  return scope.run(errors, run).then((result) => ({ result, errors }));
}

export function recordDevError(error: unknown): void {
  scope.getStore()?.push(toDevError(error, "server"));
}

/** Hands the errors of a request to the browser: embedded in the HTML for the devtools, or as the page of a bare 500 */
export async function withDevErrors(
  response: Response,
  errors: DevError[],
): Promise<Response> {
  if (!errors.length) return response;
  const type = response.headers.get("content-type") ?? "";
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (type.includes("text/html")) {
    const html = await response.text();
    const script = serializeDevErrors(errors);
    return new Response(
      html.includes("</body>")
        ? html.replace("</body>", () => script + "</body>")
        : html + script,
      { status: response.status, headers },
    );
  }
  if (response.status === 500) {
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(devErrorPage(errors), { status: 500, headers });
  }
  return response;
}
