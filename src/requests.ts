import type { FetchMode } from "./fetch-mode";

/** A doofpi request seen by the dev request inspector */
export interface RequestEntry {
  /** Where the request was made: while rendering on the server or in the browser */
  side: "server" | "browser";
  mode: FetchMode;
  /** `in-process` never touches the network (SSR `lfetch` / `pfetch` call the noofpi server directly) */
  transport: "in-process" | "http";
  method: string;
  url: string;
  /** `undefined` while the request is pending or when it failed before a response */
  status?: number;
  /** Milliseconds until the response headers arrived (or the request failed) */
  ms?: number;
  error?: string;
}

const isEntry = (value: unknown): value is RequestEntry => {
  const entry = value as Partial<RequestEntry> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry.side === "server" || entry.side === "browser") &&
    typeof entry.mode === "string" &&
    (entry.transport === "in-process" || entry.transport === "http") &&
    typeof entry.method === "string" &&
    typeof entry.url === "string"
  );
};

/** Keeps the well-formed entries of untrusted payload data */
export const parseEntries = (value: unknown): RequestEntry[] =>
  Array.isArray(value) ? value.filter(isEntry) : [];
