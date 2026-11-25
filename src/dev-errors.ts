/** An error `noofpi dev` shows in its overlay */
export interface DevError {
  /** Where it happened: while rendering on the server, in a Vue component / hook, in the browser, in a promise or in a navigation */
  source: "server" | "vue" | "window" | "promise" | "router";
  name: string;
  message: string;
  stack?: string;
  /** Extra context, e.g. the Vue lifecycle hook the error was thrown in */
  info?: string;
}

export const DEV_ERRORS_ELEMENT_ID = "__noofpi_dev_errors__";

export function toDevError(
  value: unknown,
  source: DevError["source"],
  info?: string,
): DevError {
  const error = value as { name?: unknown; message?: unknown; stack?: unknown };
  const isObject = typeof value === "object" && value !== null;
  return {
    source,
    name: isObject && typeof error.name === "string" ? error.name : "Error",
    message:
      isObject && typeof error.message === "string"
        ? error.message
        : String(value),
    ...(isObject && typeof error.stack === "string"
      ? { stack: error.stack }
      : {}),
    ...(info ? { info } : {}),
  };
}

/** JSON in a `<script>` tag; `<` and line separators are escaped so an error message cannot break out of it */
export function serializeDevErrors(errors: DevError[]): string {
  const json = JSON.stringify(errors)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" id="${DEV_ERRORS_ELEMENT_ID}">${json}</script>`;
}

/** The well-formed errors of untrusted JSON */
export function parseDevErrors(text: string): DevError[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is DevError =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.message === "string",
      )
      .map((entry) => toDevError(entry, "server", entry.info));
  } catch {
    return [];
  }
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The page of a request that failed with a 500: what went wrong and where, instead of a bare "Internal Server Error" */
export function devErrorPage(errors: DevError[]): string {
  const items = errors
    .map(
      (error) =>
        `<section><h2>${escapeHtml(error.name)}</h2><p class="message">${escapeHtml(error.message)}</p>${
          error.stack ? `<pre>${escapeHtml(error.stack)}</pre>` : ""
        }</section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Server error · noofpi</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;padding:32px;background:#18181b;color:#e4e4e7;font:14px/1.6 ui-sans-serif,system-ui,sans-serif}
main{max-width:960px;margin:0 auto}
h1{margin:0 0 4px;font-size:20px;color:#f87171}
.hint{margin:0 0 24px;color:#a1a1aa}
section{margin:0 0 16px;padding:16px;border:1px solid rgba(248,113,113,.4);border-radius:12px;background:rgba(248,113,113,.06)}
h2{margin:0;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#fca5a5}
.message{margin:6px 0 12px;font:600 16px/1.4 ui-monospace,Consolas,monospace;word-break:break-word}
pre{margin:0;overflow:auto;padding:12px;border-radius:8px;background:rgba(0,0,0,.35);font:12px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
</style>
</head>
<body>
<main>
<h1>Server error</h1>
<p class="hint">The server failed to render this page. Only shown by <code>noofpi dev</code>; production responds with a plain 500.</p>
${items}
</main>
</body>
</html>
`;
}
