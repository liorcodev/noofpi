import { reactive, ref, type Ref } from "vue";
import {
  errorsFromFailure,
  validate,
  type FormErrors,
  type FormSchema,
} from "../validation";

export interface UseDoofpiFormOptions<T, R> {
  initial: T;
  /** Called with the parsed data once it passes the schema, e.g. `(data) => client.users.create.write(data)` */
  onSubmit: (data: T) => Promise<R>;
}

export type SubmitResult<R> =
  { ok: true; result: R } | { ok: false; errors: FormErrors };

export interface DoofpiForm<T, R> {
  values: T;
  /** Field errors from the schema or from the server's validation, by path (`errors["user.email"]`) */
  errors: Ref<FormErrors>;
  /** Message of a failure that is not about a field (network, 5xx), `null` otherwise */
  failure: Ref<string | null>;
  submitting: Ref<boolean>;
  /** Validates with the schema, then calls `onSubmit`; server validation errors land in `errors` */
  submit(): Promise<SubmitResult<R>>;
  /** Validates without submitting */
  validate(): boolean;
  reset(): void;
}

/**
 * A form that validates with the same Zod schema as the doofpi endpoint (`model({ input: schema })`), so the browser
 * and the server agree, and maps the issues of a rejected request (400) onto the same `errors`.
 * Put the schema in a file both `server/` and `app/` import.
 */
export function useDoofpiForm<T extends object, R = unknown>(
  schema: FormSchema<T>,
  options: UseDoofpiFormOptions<T, R>,
): DoofpiForm<T, R> {
  const initial = () => structuredClone(options.initial);
  const values = reactive(initial()) as T;
  const errors = ref<FormErrors>({});
  const failure = ref<string | null>(null);
  const submitting = ref(false);

  const check = () => {
    const result = validate(schema, values);
    errors.value = result.ok ? {} : result.errors;
    return result;
  };

  return {
    values,
    errors,
    failure,
    submitting,
    validate: () => check().ok,
    reset() {
      Object.assign(values, initial());
      errors.value = {};
      failure.value = null;
    },
    async submit() {
      if (submitting.value) return { ok: false, errors: errors.value };
      failure.value = null;
      const checked = check();
      if (!checked.ok) return checked;
      submitting.value = true;
      try {
        return { ok: true, result: await options.onSubmit(checked.data) };
      } catch (thrown) {
        const fieldErrors = errorsFromFailure(thrown);
        if (fieldErrors) errors.value = fieldErrors;
        else
          failure.value =
            thrown instanceof Error ? thrown.message : String(thrown);
        return { ok: false, errors: errors.value };
      } finally {
        submitting.value = false;
      }
    },
  };
}
