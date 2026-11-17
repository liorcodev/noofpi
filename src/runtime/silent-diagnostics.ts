// Replaces `nostics` (see vite/config.ts) so vue-router prints nothing to the console
const diagnostic = () => new Error();

export const createConsoleReporter = () => () => {};

export const defineDiagnostics = (_options?: unknown) =>
  new Proxy({}, { get: () => diagnostic });

export const defineProdDiagnostics = defineDiagnostics;
