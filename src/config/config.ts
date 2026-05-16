/**
 * Behavior-pack configuration, read from the dedicated server's
 * `@minecraft/server-admin` stores.
 *
 * - `bridge_url` comes from `variables.json` — a non-sensitive value.
 * - `bridge_agent_token` comes from `secrets.json` — never logged, never
 *   committed (see `config/default/secrets.json.example`).
 *
 * A missing or malformed value throws {@link ConfigError}; the entrypoint logs
 * it and declines to start the poll loop, so BDS surfaces a clear failure.
 */
import { secrets, variables } from "@minecraft/server-admin";
import type { LogLevel } from "../runtime/logger";

/** Resolved, validated behavior-pack configuration. */
export interface BridgeConfig {
  /** Bridge base URL, e.g. `http://localhost:8765`. */
  readonly baseUrl: string;
  /** The bridge agent bearer token. */
  readonly token: string;
  /** Console log verbosity. */
  readonly logLevel: LogLevel;
}

/** Thrown when required configuration is missing or malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const VARIABLE_BRIDGE_URL = "bridge_url";
const VARIABLE_LOG_LEVEL = "bridge_log_level";
const SECRET_AGENT_TOKEN = "bridge_agent_token";

const LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>(["error", "warn", "info", "debug"]);

function readBaseUrl(): string {
  const value = variables.get(VARIABLE_BRIDGE_URL);
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`variables.json must define a non-empty string '${VARIABLE_BRIDGE_URL}'`);
  }
  if (!/^https?:\/\//.test(value)) {
    throw new ConfigError(`'${VARIABLE_BRIDGE_URL}' must be an http(s) URL, got '${value}'`);
  }
  return value;
}

function readToken(): string {
  const value = secrets.get(SECRET_AGENT_TOKEN);
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`secrets.json must define a non-empty string '${SECRET_AGENT_TOKEN}'`);
  }
  return value;
}

function readLogLevel(): LogLevel {
  const value = variables.get(VARIABLE_LOG_LEVEL);
  if (value === undefined) return "info";
  if (typeof value !== "string" || !LOG_LEVELS.has(value)) {
    throw new ConfigError(`'${VARIABLE_LOG_LEVEL}' must be one of error, warn, info, debug`);
  }
  return value as LogLevel;
}

/** Loads and validates configuration from the server-admin stores. */
export function loadConfig(): BridgeConfig {
  return {
    baseUrl: readBaseUrl(),
    token: readToken(),
    logLevel: readLogLevel(),
  };
}
