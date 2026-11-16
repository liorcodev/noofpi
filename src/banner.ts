import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { version as viteVersion } from "vite";

const LOGO = ["█▄ █  █▀█  █▀█  █▀▀  █▀█  █", "█ ▀█  █▄█  █▄█  █▀   █▀▀  █"];

const useColor =
  !process.env.NO_COLOR &&
  (Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout.isTTY));
const trueColor =
  useColor &&
  (process.env.COLORTERM === "truecolor" ||
    process.env.COLORTERM === "24bit" ||
    Boolean(process.env.WT_SESSION) ||
    process.env.TERM_PROGRAM === "vscode");

const wrap = (open: string, close: string) => (text: string) =>
  useColor ? `\x1b[${open}m${text}\x1b[${close}m` : text;
const bold = wrap("1", "22");
const dim = wrap("2", "22");
const green = wrap("32", "39");
const cyan = wrap("36", "39");

// Green -> cyan -> violet
type Rgb = readonly [number, number, number];
const STOPS: readonly Rgb[] = [
  [52, 211, 153],
  [56, 189, 248],
  [167, 139, 250],
];

function gradientAt(t: number): Rgb {
  const scaled = t * (STOPS.length - 1);
  const index = Math.min(Math.floor(scaled), STOPS.length - 2);
  const local = scaled - index;
  const [r1, g1, b1] = STOPS[index]!;
  const [r2, g2, b2] = STOPS[index + 1]!;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * local);
  return [mix(r1, r2), mix(g1, g2), mix(b1, b2)];
}

function gradient(text: string): string {
  if (!trueColor) return useColor ? cyan(text) : text;
  const last = Math.max(text.length - 1, 1);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const [r, g, b] = gradientAt(i / last);
    out += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
  }
  return out + "\x1b[39m";
}

function packageVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf-8")).version as string;
  } catch {
    return "";
  }
}

function networkAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal)
        addresses.push(entry.address);
    }
  }
  return addresses;
}

const isWildcard = (host: string) => host === "0.0.0.0" || host === "::";
const isLoopback = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "::1";

export function localUrl(host: string, port: number): string {
  return `http://${isWildcard(host) ? "localhost" : host}:${port}/`;
}

export function printBanner(options: {
  mode: "development" | "production";
  host: string;
  port: number;
  startedAt: number;
  shortcuts?: boolean;
}) {
  const { mode, host, port } = options;
  const local = localUrl(host, port);
  const network = isWildcard(host)
    ? networkAddresses().map((address) => `http://${address}:${port}/`)
    : [];

  const elapsed = Math.round(performance.now() - options.startedAt);
  const version = packageVersion();
  const rows: string[] = [
    `${green("●")} ${bold("Ready")} ${dim(`in ${elapsed} ms`)}`,
    "",
    `${green("➜")}  ${bold("Local")}    ${cyan(bold(local))}`,
    ...network.map(
      (address) => `${green("➜")}  ${bold("Network")}  ${cyan(address)}`,
    ),
  ];
  if (!network.length && isLoopback(host))
    rows.push(`${dim("➜")}  ${dim("Network")}  ${dim("use --host to expose")}`);
  if (options.shortcuts)
    rows.push(
      "",
      `${dim("➜")}  ${dim("press")} ${bold("b")} ${dim("to open the browser,")} ${bold("q")} ${dim("to quit")}`,
    );

  const meta = [
    version && `noofpi ${version}`,
    `vite ${viteVersion}`,
    `node ${process.version}`,
    mode,
  ].filter(Boolean);

  const lines = [
    "",
    ...LOGO.map((line) => "  " + gradient(line)),
    "",
    ...rows.map((row) => "  " + row),
    "",
    "  " + dim(meta.join("  ·  ")),
    "",
  ];
  console.log(lines.join("\n"));
}
