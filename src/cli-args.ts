import { parseArgs } from "node:util";

export const COMMANDS = [
  "dev",
  "build",
  "start",
  "preview",
  "prepare",
  "typecheck",
] as const;
export type Command = (typeof COMMANDS)[number];

export interface CliArgs {
  command: Command | undefined;
  /** Arguments after the command, only accepted by `typecheck` (it passes them to vue-tsc) */
  rest: string[];
  help: boolean;
  version: boolean;
  open: boolean;
  root: string | undefined;
  port: number | undefined;
  host: string | undefined;
  preset: string | undefined;
}

/** A mistake in the command line, reported together with a hint to the usage */
export class CliUsageError extends Error {}

export function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535)
    throw new CliUsageError(
      `[noofpi] --port must be an integer between 0 and 65535 (got "${value}")`,
    );
  return port;
}

const parse = (args: string[]) =>
  parseArgs({
    args,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      preset: { type: "string" },
      open: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Drop node's advice about `--`, which does not apply to noofpi's own options
    throw new CliUsageError(
      `[noofpi] ${message.replace(/\. To specify[\s\S]*$/, "")}`,
    );
  }

  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  const args: CliArgs = {
    command: undefined,
    rest,
    help: values.help ?? false,
    version: values.version ?? false,
    open: values.open ?? false,
    root: values.root,
    port: values.port === undefined ? undefined : parsePort(values.port),
    host: values.host,
    preset: values.preset,
  };

  if (command !== undefined) {
    if (!COMMANDS.includes(command as Command))
      throw new CliUsageError(
        `[noofpi] Unknown command "${command}" (expected ${COMMANDS.join(" | ")})`,
      );
    args.command = command as Command;
    if (rest.length && args.command !== "typecheck" && !args.help)
      throw new CliUsageError(`[noofpi] Unexpected argument "${rest[0]}"`);
  }
  return args;
}
