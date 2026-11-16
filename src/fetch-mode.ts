export const FETCH_MODES = ["dfetch", "pfetch", "lfetch", "sfetch"] as const;

/**
 * - `dfetch`: client -> doofpi API directly
 * - `pfetch`: client -> noofpi server (proxy) -> doofpi API
 * - `lfetch`: client -> noofpi's own doofpi API (`server/doofpi.ts`)
 * - `sfetch`: server only, never from the browser
 */
export type FetchMode = (typeof FETCH_MODES)[number];
