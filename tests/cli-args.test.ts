import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "../src/cli-args";

describe("parseCliArgs", () => {
  it("reads the command and options in both `--name value` and `--name=value` form", () => {
    expect(
      parseCliArgs(["dev", "--port", "4000", "--host=0.0.0.0", "--open"]),
    ).toMatchObject({
      command: "dev",
      port: 4000,
      host: "0.0.0.0",
      open: true,
    });
    expect(parseCliArgs(["build", "--preset=docker"])).toMatchObject({
      command: "build",
      preset: "docker",
      open: false,
    });
  });

  it("accepts the options before the command", () => {
    expect(parseCliArgs(["--root", "app", "start"])).toMatchObject({
      command: "start",
      root: "app",
    });
  });

  it("recognizes help and version without a command", () => {
    expect(parseCliArgs(["--help"])).toMatchObject({ help: true });
    expect(parseCliArgs(["-h"])).toMatchObject({ help: true });
    expect(parseCliArgs(["-v"])).toMatchObject({ version: true });
    expect(parseCliArgs(["dev", "--help"])).toMatchObject({
      command: "dev",
      help: true,
    });
    expect(parseCliArgs([])).toMatchObject({ command: undefined });
  });

  it.each(["abc", "-1", "1.5", "70000", ""])("rejects the port %j", (port) => {
    expect(() => parseCliArgs(["dev", "--port", port])).toThrow(CliUsageError);
  });

  it("rejects a missing option value, an unknown option and an unknown command", () => {
    expect(() => parseCliArgs(["dev", "--port"])).toThrow(/--port/);
    expect(() => parseCliArgs(["dev", "--nope"])).toThrow(
      /Unknown option '--nope'$/,
    );
    expect(() => parseCliArgs(["deploy"])).toThrow(/Unknown command "deploy"/);
  });

  it("passes the arguments after `--` on for typecheck only", () => {
    expect(
      parseCliArgs(["typecheck", "--", "--project", "tsconfig.app.json"]).rest,
    ).toEqual(["--project", "tsconfig.app.json"]);
    expect(() => parseCliArgs(["build", "extra"])).toThrow(
      /Unexpected argument "extra"/,
    );
  });
});
