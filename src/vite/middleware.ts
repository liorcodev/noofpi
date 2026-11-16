import { scanPages } from "./layouts";

const USE_MIDDLEWARE = /^\s*\(\s*(?:(['"`])([^'"`$\n]+)\1|\[([^\]]*)\])\s*\)/;
const CALL = /\buseMiddleware\b(?=\s*\()/g;
const LITERAL = /^(['"`])([^'"`$\n]+)\1$/;

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

/**
 * The literals passed to the `useMiddleware('a')` / `useMiddleware(['a', 'b'])` call in a page, if any.
 * Throws when a call cannot be read (a guard that silently is not applied is worse than a failed build).
 */
export function extractMiddleware(source: string): string[] | undefined {
  const code = stripComments(source);
  const calls = [...code.matchAll(CALL)];
  if (!calls.length) return undefined;
  if (calls.length > 1)
    throw new Error("useMiddleware() must be called only once per page");
  const rest = code.slice(calls[0]!.index + calls[0]![0].length);
  const match = USE_MIDDLEWARE.exec(rest);
  const unreadable = new Error(
    "useMiddleware() must be called with string literals, e.g. useMiddleware('auth')",
  );
  if (!match) throw unreadable;
  if (match[2] !== undefined) return [match[2]];
  const names: string[] = [];
  for (const item of (match[3] ?? "").split(",")) {
    if (!item.trim()) continue;
    const literal = LITERAL.exec(item.trim());
    if (!literal) throw unreadable;
    names.push(literal[2]!);
  }
  return names;
}

/** Named middleware per page, keyed like `import.meta.glob` keys. Pages without `useMiddleware` are omitted. */
export function scanPageMiddleware(root: string): Record<string, string[]> {
  return scanPages(root, extractMiddleware);
}
