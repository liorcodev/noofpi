/** The part of a Zod issue that noofpi reads; doofpi's `issues` and `schema.safeParse()` errors satisfy it */
export interface ValidationIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** Messages by field path (`"user.email"`, `"tags.0"`). Issues about the whole value are under {@link FORM_ERROR_KEY} */
export type FormErrors = Record<string, string[]>;

export const FORM_ERROR_KEY = "";

/** Any schema with a Zod-style `safeParse` (Zod 3 and 4) */
export interface FormSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly ValidationIssue[] } };
}

export type InferSchema<S> = S extends FormSchema<infer T> ? T : never;

export type ValidationResult<T> =
  { ok: true; data: T } | { ok: false; errors: FormErrors };

/** Groups issues by field path, the same shape on the server and in the browser */
export function issuesToErrors(
  issues: readonly ValidationIssue[] | undefined,
): FormErrors {
  const errors: FormErrors = {};
  for (const issue of issues ?? []) {
    const key = issue.path.map(String).join(".");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/** Validates with the schema shared by the server endpoint and the form */
export function validate<T>(
  schema: FormSchema<T>,
  value: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, errors: issuesToErrors(result.error.issues) };
}

/**
 * The field errors of a doofpi input validation failure (a `DoofpiClientError` with status 400 and `issues`), or
 * `undefined` for any other failure
 */
export function errorsFromFailure(failure: unknown): FormErrors | undefined {
  if (typeof failure !== "object" || failure === null) return undefined;
  const { status, issues } = failure as { status?: unknown; issues?: unknown };
  if (status !== 400 || !Array.isArray(issues)) return undefined;
  return issuesToErrors(issues);
}
