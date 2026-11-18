import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeDoofpiTypes } from "../src/vite/types";

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("writeDoofpiTypes", () => {
  it("registers server/doofpi.ts routes when the project has one", () => {
    root = mkdtempSync(path.join(tmpdir(), "noofpi-types-"));
    mkdirSync(path.join(root, "server"));
    writeFileSync(
      path.join(root, "server/doofpi.ts"),
      "export const routes = {};",
    );
    writeDoofpiTypes(root, "pfetch");
    const dts = path.join(root, ".noofpi/doofpi.d.ts");
    expect(existsSync(dts)).toBe(true);
    const content = readFileSync(dts, "utf8");
    expect(content).toContain(
      'import type * as server from "../server/doofpi"',
    );
    expect(content).toContain("localRoutes: typeof server");
    expect(content).toContain('defaultFetch: "pfetch"');
    expect(content).not.toMatch(/\n\s+routes:/);
  });

  it("writes nothing without server/doofpi.ts", () => {
    root = mkdtempSync(path.join(tmpdir(), "noofpi-types-"));
    writeDoofpiTypes(root);
    expect(existsSync(path.join(root, ".noofpi"))).toBe(false);
  });
});
