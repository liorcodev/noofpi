/** A directive's sources: `["'self'", "https://cdn.example.com"]` or `"'self' https://cdn.example.com"`. `true` renders a bare directive (`upgrade-insecure-requests`), `false` omits it */
export type CspDirectiveValue = string | string[] | boolean;

export type CspDirectiveName =
  | "default-src"
  | "script-src"
  | "script-src-elem"
  | "script-src-attr"
  | "style-src"
  | "style-src-elem"
  | "style-src-attr"
  | "img-src"
  | "font-src"
  | "connect-src"
  | "media-src"
  | "object-src"
  | "child-src"
  | "frame-src"
  | "worker-src"
  | "manifest-src"
  | "base-uri"
  | "form-action"
  | "frame-ancestors"
  | "sandbox"
  | "report-uri"
  | "report-to"
  | "upgrade-insecure-requests"
  | "require-trusted-types-for"
  | "trusted-types"
  | (string & {});

export interface CspConfig {
  /**
   * Directives of the `Content-Security-Policy` header sent with every HTML page.
   * Put `'nonce'` in a directive (typically `script-src` / `style-src`) to get a fresh nonce per request: it becomes
   * `'nonce-<value>'` in the header and `nonce="<value>"` is added to every `<script>`, `<style>` and stylesheet /
   * preload `<link>` of the page shell.
   */
  directives: Partial<Record<CspDirectiveName, CspDirectiveValue>>;
  /** Send `Content-Security-Policy-Report-Only` instead, so violations are reported but not blocked */
  reportOnly?: boolean;
}

/** The token that stands for the per-request nonce inside a directive */
export const NONCE_TOKEN = "'nonce'";

const DIRECTIVE_NAME = /^[a-z][a-z0-9-]*$/;
// `;` and `,` separate directives / policies, control characters would break the header
const FORBIDDEN_VALUE = /[;,\u0000-\u001f\u007f]/;

function sources(value: CspDirectiveValue): string[] {
  if (typeof value === "boolean") return [];
  return (Array.isArray(value) ? value : value.split(/\s+/)).filter(Boolean);
}

export function validateCsp(csp: CspConfig): void {
  if (
    !csp ||
    typeof csp.directives !== "object" ||
    csp.directives === null ||
    Array.isArray(csp.directives)
  )
    throw new Error("[noofpi] security.csp.directives must be an object");
  for (const [name, value] of Object.entries(csp.directives)) {
    if (!DIRECTIVE_NAME.test(name))
      throw new Error(
        `[noofpi] security.csp: "${name}" is not a valid directive name (use lowercase kebab-case, e.g. "script-src")`,
      );
    if (value === undefined) continue;
    if (
      typeof value !== "boolean" &&
      typeof value !== "string" &&
      !(Array.isArray(value) && value.every((s) => typeof s === "string"))
    )
      throw new Error(
        `[noofpi] security.csp: "${name}" must be a string, an array of strings or a boolean`,
      );
    for (const source of sources(value))
      if (FORBIDDEN_VALUE.test(source))
        throw new Error(
          `[noofpi] security.csp: "${name}" has an invalid source "${source}" (no ";", "," or control characters)`,
        );
  }
}

/** Whether any directive asks for a per-request nonce */
export function usesNonce(csp: CspConfig | undefined): boolean {
  return Object.values(csp?.directives ?? {}).some(
    (value) => value !== undefined && sources(value).includes(NONCE_TOKEN),
  );
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `[header name, header value]` for the config, with `'nonce'` replaced by `'nonce-<nonce>'` */
export function buildCspHeader(
  csp: CspConfig,
  nonce?: string,
): [name: string, value: string] {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(csp.directives)) {
    if (value === undefined || value === false) continue;
    const list = sources(value).map((source) =>
      source === NONCE_TOKEN && nonce ? `'nonce-${nonce}'` : source,
    );
    parts.push([name, ...list].join(" "));
  }
  return [
    csp.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    parts.join("; "),
  ];
}

const NONCED_LINK_REL =
  /\brel\s*=\s*["']?(stylesheet|modulepreload|preload)\b/i;

function withNonce(tag: string, attrs: string, nonce: string): string {
  if (/\snonce\s*=/i.test(attrs)) return `<${tag}${attrs}>`;
  const selfClosing = /\/\s*$/.test(attrs);
  const open = attrs.replace(/\s*\/?\s*$/, "");
  return `<${tag}${open} nonce="${nonce}"${selfClosing ? " /" : ""}>`;
}

/**
 * Adds the nonce to the `<script>`, `<style>` and stylesheet / preload `<link>` tags of an HTML shell, and a
 * `<meta property="csp-nonce">` that vite reads for the styles and preloads it injects at runtime.
 * Run it on the shell only, before the rendered page is inserted, so markup from the app never gets a nonce.
 */
export function injectNonce(html: string, nonce: string): string {
  let result = html.replace(
    /<(script|style)\b([^>]*)>/gi,
    (_whole, tag: string, attrs: string) => withNonce(tag, attrs, nonce),
  );
  result = result.replace(/<link\b([^>]*)>/gi, (whole, attrs: string) =>
    NONCED_LINK_REL.test(attrs) ? withNonce("link", attrs, nonce) : whole,
  );
  const meta = `    <meta property="csp-nonce" nonce="${nonce}" />\n`;
  return result.includes("</head>")
    ? result.replace("</head>", () => meta + "  </head>")
    : result;
}
