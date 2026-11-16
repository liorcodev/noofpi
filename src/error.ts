/** The error shown by `app/error.vue`: what the page receives in its `error` prop */
export interface NoofpiErrorData {
  statusCode: number;
  statusMessage: string;
  message: string;
  /** The URL that was being rendered */
  url?: string;
}

export interface CreateErrorInput {
  statusCode?: number;
  statusMessage?: string;
  message?: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/** Only error statuses can be answered with an error page */
const validStatus = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 400 &&
  (value as number) <= 599;

/** Marks errors made by `createError()`, which stay recognizable when the module is loaded twice */
const BRAND = "__noofpiError";

export class NoofpiError extends Error implements NoofpiErrorData {
  readonly [BRAND] = true;
  statusCode: number;
  statusMessage: string;
  url?: string;

  constructor(input: CreateErrorInput = {}) {
    const statusCode = validStatus(input.statusCode) ? input.statusCode : 500;
    const statusMessage =
      input.statusMessage ?? STATUS_TEXT[statusCode] ?? "Error";
    super(input.message ?? statusMessage);
    this.name = "NoofpiError";
    this.statusCode = statusCode;
    this.statusMessage = statusMessage;
  }
}

/**
 * Creates an error to `throw`  from a page's setup, a route middleware (or pass it to
 * `showError()`): when the project has an `app/error.vue`, it is rendered with this error and the response gets its status.
 */
export function createError(input: string | CreateErrorInput): NoofpiError {
  return new NoofpiError(
    typeof input === "string" ? { message: input } : input,
  );
}

export function isNoofpiError(error: unknown): error is NoofpiError {
  return error instanceof Error && (error as any)[BRAND] === true;
}

/**
 * Plain, serializable data for the error page. Only errors made with `createError()` expose their message; anything
 * else is an unexpected failure whose details must not reach the browser.
 */
export function toErrorData(error: unknown, url?: string): NoofpiErrorData {
  const known = isNoofpiError(error) ? error : createError({});
  return {
    statusCode: known.statusCode,
    statusMessage: known.statusMessage,
    message: known.message,
    ...((known.url ?? url) !== undefined ? { url: known.url ?? url } : {}),
  };
}

/** Parses an error out of untrusted JSON (the payload) */
export function parseErrorData(value: unknown): NoofpiErrorData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { statusCode, statusMessage, message, url } = value as Record<
    string,
    unknown
  >;
  if (typeof statusCode !== "number") return undefined;
  return {
    statusCode,
    statusMessage: typeof statusMessage === "string" ? statusMessage : "Error",
    message: typeof message === "string" ? message : "",
    ...(typeof url === "string" ? { url } : {}),
  };
}
