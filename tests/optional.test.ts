import { describe, expect, it } from "vitest";
import { importOptional } from "../src/optional";

const notFound = (message: string) =>
  Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });

describe("importOptional", () => {
  it("returns the module", async () => {
    expect(await importOptional(async () => 42, ["sharp"], "feature")).toBe(42);
  });

  it("names the feature and the packages when one is missing", async () => {
    const cause = notFound("Cannot find package 'sharp' imported from x");
    await expect(
      importOptional(() => Promise.reject(cause), ["sharp"], "Images"),
    ).rejects.toThrow(/Images needs sharp: install it .*bun add sharp/);
  });

  it("passes on other failures, including a missing package that is not an optional one", async () => {
    const other = notFound("Cannot find package 'lodash' imported from x");
    await expect(
      importOptional(() => Promise.reject(other), ["sharp"], "Images"),
    ).rejects.toBe(other);
    const broken = new Error("boom");
    await expect(
      importOptional(() => Promise.reject(broken), ["sharp"], "Images"),
    ).rejects.toBe(broken);
  });
});
