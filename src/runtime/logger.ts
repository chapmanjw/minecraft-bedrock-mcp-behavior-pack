/**
 * A small leveled logger over the BDS script `console`.
 *
 * Every line is passed through secret redaction before it is written, so the
 * bridge agent token can never reach the content log even if it is accidentally
 * included in a message or context object.
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

const redactedSecrets = new Set<string>();

/**
 * Registers a secret to redact from all future log output. Short values are
 * ignored — redacting them would corrupt unrelated messages.
 */
export function redactSecret(secret: string): void {
  if (secret.length >= 6) redactedSecrets.add(secret);
}

function redact(text: string): string {
  let output = text;
  for (const secret of redactedSecrets) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
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
    const line = redact(`[${scope}] ${level.toUpperCase()} ${message}${formatContext(context)}`);
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
