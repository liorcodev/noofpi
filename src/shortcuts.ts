import { spawn } from "node:child_process";

export function openBrowser(url: string) {
  const [command, args]: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`  Could not open the browser: ${url}`));
  child.unref();
}

/** Returns false when there is no interactive terminal, so no shortcuts are bound. */
export function bindShortcuts(options: {
  url: string;
  close: () => Promise<void>;
}): boolean {
  const { stdin } = process;
  if (!stdin.isTTY || !process.stdout.isTTY) return false;

  let closing = false;
  const quit = () => {
    if (closing) return;
    closing = true;
    options.close().finally(() => process.exit(0));
  };

  stdin.setRawMode(true);
  stdin.setEncoding("utf-8");
  stdin.resume();
  stdin.on("data", (key: string) => {
    // Raw mode disables the terminal's own Ctrl+C handling
    if (key === "\x03" || key.toLowerCase() === "q") quit();
    else if (key.toLowerCase() === "b") openBrowser(options.url);
  });
  return true;
}
