import { createClient, DoofpiClientError } from "doofpi";
import Doofpi from "doofpi";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useDoofpiForm } from "../src/runtime/form";
import { errorsFromFailure, issuesToErrors, validate } from "../src/validation";

const schema = z.object({
  name: z.string().min(2, "too short"),
  tags: z.array(z.string().min(1, "empty tag")),
});

describe("validation", () => {
  it("groups issues by dotted path", () => {
    const result = validate(schema, { name: "a", tags: ["x", ""] });
    expect(result).toEqual({
      ok: false,
      errors: { name: ["too short"], "tags.1": ["empty tag"] },
    });
  });

  it("returns the parsed data when valid", () => {
    expect(validate(schema, { name: "ab", tags: [] })).toEqual({
      ok: true,
      data: { name: "ab", tags: [] },
    });
  });

  it("maps only 400 failures with issues", () => {
    const issues = [{ path: ["name"], message: "bad" }] as any;
    expect(
      errorsFromFailure(
        new DoofpiClientError({ message: "x", status: 400, issues }),
      ),
    ).toEqual({ name: ["bad"] });
    expect(
      errorsFromFailure(
        new DoofpiClientError({ message: "x", status: 500, issues }),
      ),
    ).toBeUndefined();
    expect(errorsFromFailure(new Error("net"))).toBeUndefined();
    expect(issuesToErrors(undefined)).toEqual({});
  });
});

describe("useDoofpiForm", () => {
  it("blocks submit on client validation errors", async () => {
    let called = false;
    const form = useDoofpiForm(schema, {
      initial: { name: "", tags: [] },
      onSubmit: async () => (called = true),
    });
    const result = await form.submit();
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    expect(form.errors.value).toEqual({ name: ["too short"] });
  });

  it("maps the errors of a real doofpi endpoint that uses the same schema", async () => {
    const d = new Doofpi({ root: "/doofpi" });
    const routes = d.routes({
      create: d.endpointBuilder
        .model({ input: schema, output: z.object({ ok: z.boolean() }) })
        .write(() => ({ ok: true })),
    });
    d.register(routes);
    const client = createClient<typeof routes>({
      url: "http://localhost",
      fetch: (url, init) => d.fetch(new Request(url as string, init)),
    });
    // Skips the client check to prove the server rejects with the same shape
    const loose = { safeParse: (v: unknown) => ({ success: true, data: v }) };
    const form = useDoofpiForm(loose as any, {
      initial: { name: "a", tags: [] },
      onSubmit: (data: any) => client.create.write(data),
    });
    const result = await form.submit();
    expect(result.ok).toBe(false);
    expect(form.errors.value).toEqual({ name: ["too short"] });
    expect(form.failure.value).toBeNull();

    form.values.name = "ok";
    expect(await form.submit()).toEqual({ ok: true, result: { ok: true } });
    expect(form.errors.value).toEqual({});
  });

  it("reports other failures and resets", async () => {
    const form = useDoofpiForm(schema, {
      initial: { name: "ab", tags: [] },
      onSubmit: async () => {
        throw new Error("offline");
      },
    });
    form.values.name = "abc";
    await form.submit();
    expect(form.failure.value).toBe("offline");
    expect(form.submitting.value).toBe(false);
    form.reset();
    expect(form.values.name).toBe("ab");
    expect(form.failure.value).toBeNull();
  });
});
