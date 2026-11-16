export type HeadAttrValue = string | number | boolean | null | undefined;
/** Attributes of a tag: `{ name: "description", content: "..." }`. `true` renders a bare attribute, `false`/`null`/`undefined` omit it */
export type HeadTag = Record<string, HeadAttrValue>;

export interface HeadInput {
  /**
   * In `useHead()`: the page title. In the config: the default title; put `%s` where the page title goes
   * (`"%s | My site"`). Without `%s`, a page title replaces the default.
   */
  title?: string;
  meta?: HeadTag[];
  link?: HeadTag[];
  htmlAttrs?: Record<string, HeadAttrValue>;
  bodyAttrs?: Record<string, HeadAttrValue>;
}

/** `head` option of `noofpi.config.ts`: defaults for every page */
export type HeadConfig = HeadInput;

export interface ResolvedHead {
  title: string;
  meta: Record<string, string>[];
  link: Record<string, string>[];
  htmlAttrs: Record<string, string>;
  bodyAttrs: Record<string, string>;
}

export const DEFAULT_TITLE = "noofpi";
/** Marks tags written by noofpi so the browser can replace them on navigation */
export const HEAD_TAG_ATTR = "data-noofpi-head";
/** Lists the `<html>` / `<body>` attributes noofpi set, so the browser can remove them on navigation */
export const HEAD_ATTRS_ATTR = "data-noofpi-attrs";

const BASE_HTML_ATTRS = { lang: "en" };
const TITLE_SEPARATORS = /^[\s|\-–—·:•]+|[\s|\-–—·:•]+$/g;

// Names that cannot break out of a tag; `on*` event handlers are never written, whatever the CSP says
const SAFE_ATTR_NAME = /^[^\s"'<>/=\u0000-\u001f\u007f]+$/;
const isSafeAttrName = (name: string) =>
  SAFE_ATTR_NAME.test(name) && !/^on/i.test(name);

function normalizeAttrs(
  attrs: Record<string, HeadAttrValue> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (!isSafeAttrName(name)) continue;
    result[name] = value === true ? "" : String(value);
  }
  return result;
}

function tagKey(kind: "meta" | "link", tag: Record<string, string>) {
  if (kind === "meta") {
    if ("charset" in tag) return "charset";
    for (const name of ["name", "property", "http-equiv", "itemprop"])
      if (name in tag) return `${name}:${tag[name]}`;
    return undefined;
  }
  if (tag.rel === "canonical") return "canonical";
  return tag.rel && tag.href
    ? `${tag.rel}|${tag.href}|${tag.hreflang ?? ""}`
    : undefined;
}

/** Later tags replace earlier ones with the same identity (`name`, `property`, canonical link, ...) */
function mergeTags(
  kind: "meta" | "link",
  lists: (HeadTag[] | undefined)[],
): Record<string, string>[] {
  const tags = new Map<string, Record<string, string>>();
  let anonymous = 0;
  for (const list of lists)
    for (const raw of list ?? []) {
      const tag = normalizeAttrs(raw);
      tags.set(tagKey(kind, tag) ?? `#${anonymous++}`, tag);
    }
  return [...tags.values()];
}

function resolveTitle(template: string | undefined, title: string | undefined) {
  if (title)
    return template?.includes("%s") ? template.split("%s").join(title) : title;
  if (!template) return DEFAULT_TITLE;
  // No page title: `"%s | My site"` becomes `"My site"`
  return (
    template.split("%s").join("").replace(TITLE_SEPARATORS, "") || DEFAULT_TITLE
  );
}

/** Merges the config defaults with the entries of the current page (later entries win) */
export function resolveHead(
  defaults?: HeadConfig,
  entries: HeadInput[] = [],
): ResolvedHead {
  const all = [defaults ?? {}, ...entries];
  const pageTitle = entries
    .map((entry) => entry.title)
    .filter(Boolean)
    .pop();
  return {
    title: resolveTitle(defaults?.title, pageTitle),
    meta: mergeTags(
      "meta",
      all.map((input) => input.meta),
    ),
    link: mergeTags(
      "link",
      all.map((input) => input.link),
    ),
    htmlAttrs: Object.assign(
      { ...BASE_HTML_ATTRS },
      ...all.map((input) => normalizeAttrs(input.htmlAttrs)),
    ),
    bodyAttrs: Object.assign(
      {},
      ...all.map((input) => normalizeAttrs(input.bodyAttrs)),
    ),
  };
}

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value: string) => escapeText(value).replace(/"/g, "&quot;");

const renderAttrs = (attrs: Record<string, string>) =>
  Object.entries(attrs)
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
    .join(" ");

const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Sets attributes on the opening `<html>` / `<body>` tag, replacing ones with the same name */
function mergeTagAttrs(
  html: string,
  tag: "html" | "body",
  attrs: Record<string, string>,
): string {
  return html.replace(
    new RegExp(`<${tag}\\b([^>]*)>`, "i"),
    (whole, rest: string) => {
      const existing = new Map<string, string>();
      for (const match of rest.matchAll(ATTRIBUTE))
        existing.set(
          match[1]!.toLowerCase(),
          match[2] ?? match[3] ?? match[4] ?? "",
        );
      existing.delete(HEAD_ATTRS_ATTR);
      const changed = Object.entries(attrs).filter(
        ([name, value]) => existing.get(name.toLowerCase()) !== value,
      );
      if (!changed.length) return whole;
      const kept = [...existing].filter(
        ([name]) =>
          !changed.some(([changedName]) => changedName.toLowerCase() === name),
      );
      const merged = {
        ...Object.fromEntries(kept),
        ...Object.fromEntries(changed),
        [HEAD_ATTRS_ATTR]: changed.map(([name]) => name).join(" "),
      };
      return `<${tag} ${renderAttrs(merged)}>`;
    },
  );
}

/** Writes the resolved head into an HTML document: `<title>`, `<meta>` / `<link>` tags and `<html>` / `<body>` attributes */
export function applyHead(html: string, head: ResolvedHead): string {
  let result = html;
  const title = `<title>${escapeText(head.title)}</title>`;
  if (/<title>[\s\S]*?<\/title>/i.test(result))
    result = result.replace(/<title>[\s\S]*?<\/title>/i, () => title);
  else result = result.replace("</head>", () => `    ${title}\n  </head>`);

  // The shell ships a charset and a viewport; a page-level one replaces them
  if (head.meta.some((tag) => "charset" in tag))
    result = result.replace(/\s*<meta\s+charset=[^>]*>/i, "");
  if (head.meta.some((tag) => tag.name === "viewport"))
    result = result.replace(/\s*<meta\s+name="viewport"[^>]*>/i, "");

  const tags = [
    ...head.meta.map((attrs) => ["meta", attrs] as const),
    ...head.link.map((attrs) => ["link", attrs] as const),
  ].map(
    ([name, attrs]) =>
      `    <${name} ${renderAttrs({ ...attrs, [HEAD_TAG_ATTR]: "" })} />\n`,
  );
  if (tags.length)
    result = result.replace("</head>", () => tags.join("") + "  </head>");

  result = mergeTagAttrs(result, "html", head.htmlAttrs);
  if (Object.keys(head.bodyAttrs).length)
    result = mergeTagAttrs(result, "body", head.bodyAttrs);
  return result;
}
