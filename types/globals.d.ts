// Ambient globals the BDS script runtime provides but the `ES2020` TypeScript
// lib does not declare. The runtime is not a browser and not Node — only the
// surface the behavior pack actually relies on is declared here.

/** The console the BDS script runtime exposes; output goes to the content log. */
declare const console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
