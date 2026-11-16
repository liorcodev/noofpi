import { parseErrorData, type NoofpiErrorData } from "./error";
import { parseEntries, type RequestEntry } from "./requests";

/** Data collected during SSR and handed to the browser so it does not fetch again */
export interface PayloadData {
  data: Record<string, unknown>;
  errors: Record<string, AsyncDataError>;
  /** Values of `useState` by key */
  state?: Record<string, unknown>;
  /** Set when the server rendered the error page, so the browser hydrates the same one */
  error?: NoofpiErrorData;
  /** The locale the server rendered in (only with `i18n`), so the browser hydrates in the same one */
  locale?: string;
  /** Dev only: the doofpi requests the server made while rendering, for the dev request inspector */
  requests?: RequestEntry[];
}

export interface AsyncDataError {
  message: string;
  status?: number;
}

export const PAYLOAD_ELEMENT_ID = "__noofpi_payload__";

export const isEmptyPayload = (payload: PayloadData) =>
  Object.keys(payload.data).length === 0 &&
  Object.keys(payload.errors).length === 0 &&
  Object.keys(payload.state ?? {}).length === 0 &&
  !payload.error &&
  !payload.locale &&
  !payload.requests?.length;

/** JSON in a `<script>` tag; `<` and line separators are escaped so the data cannot break out of it */
export function serializePayload(payload: PayloadData): string {
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" id="${PAYLOAD_ELEMENT_ID}">${json}</script>`;
}

/** Inserts the payload script before `</body>` (or at the end when there is none) */
export function injectPayload(html: string, payload: PayloadData): string {
  if (isEmptyPayload(payload)) return html;
  const script = serializePayload(payload);
  return html.includes("</body>")
    ? html.replace("</body>", () => script + "</body>")
    : html + script;
}

/** Browser only: reads (and removes) the payload element written by the server */
export function readPayload(): PayloadData {
  const element = document.getElementById(PAYLOAD_ELEMENT_ID);
  if (!element) return { data: {}, errors: {} };
  element.remove();
  try {
    const parsed = JSON.parse(
      element.textContent ?? "",
    ) as Partial<PayloadData>;
    const error = parseErrorData(parsed.error);
    const requests = parseEntries(parsed.requests);
    const locale =
      typeof parsed.locale === "string" ? parsed.locale : undefined;
    const state =
      parsed.state && typeof parsed.state === "object" ? parsed.state : {};
    return {
      data: parsed.data ?? {},
      errors: parsed.errors ?? {},
      state,
      ...(error ? { error } : {}),
      ...(locale ? { locale } : {}),
      ...(requests.length ? { requests } : {}),
    };
  } catch {
    return { data: {}, errors: {} };
  }
}
