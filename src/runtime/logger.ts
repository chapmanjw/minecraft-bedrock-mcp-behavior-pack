/**
 * A small leveled logger over the BDS script `console`.
 *
 * The bridge agent token never reaches the script environment as a readable
 * string — `secrets.get` hands back an opaque `SecretString` — so no log line
 * can leak it, and the logger needs no redaction pass.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/** A scoped, leveled logger. */
export interface Logger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  /** Derives a logger that prefixes every line with an additional scope. */
  child(scope: string): Logger;
}

function formatContext(context: Record<string, unknown> | undefined): string {
  if (context === undefined) return "";
  try {
    return ` ${JSON.stringify(context)}`;
  } catch {
    return " [uninspectable context]";
  }
}

const SINKS: Readonly<Record<LogLevel, (line: string) => void>> = {
  error: (line) => console.error(line),
  warn: (line) => console.warn(line),
  info: (line) => console.info(line),
  debug: (line) => console.log(line),
};

/** Creates a logger that emits lines at or below `threshold`. */
export function createLogger(threshold: LogLevel, scope = "bedrock-bridge"): Logger {
  function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[threshold]) return;
    const line = `[${scope}] ${level.toUpperCase()} ${message}${formatContext(context)}`;
    SINKS[level](line);
  }
  return {
    error: (message, context) => emit("error", message, context),
    warn: (message, context) => emit("warn", message, context),
    info: (message, context) => emit("info", message, context),
    debug: (message, context) => emit("debug", message, context),
    child: (childScope) => createLogger(threshold, `${scope}:${childScope}`),
  };
}
