/**
 * Command results posted by the behavior pack to `POST /bridge/result`.
 *
 * Wire shapes mirror `protocol/result.ts` in the MCP server repository.
 */

/** A behavior-pack error code. Case-sensitive; the server has a stable allowlist. */
export type ErrorCode =
  | "INVALID_INPUT"
  | "BEHAVIOR_PACK_ERROR"
  | "NOT_FOUND"
  | "UNSUPPORTED_CAPABILITY"
  | "INTERNAL";

/** An error reported by the behavior pack for a failed command. */
export interface CommandError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

/** A successful command result. */
export interface CommandResultOk {
  readonly id: string;
  readonly status: "ok";
  readonly result: unknown;
}

/** A failed command result. */
export interface CommandResultError {
  readonly id: string;
  readonly status: "error";
  readonly error: CommandError;
}

/**
 * The result of a command — a discriminated union on `status`. An `ok` result
 * carries a `result` payload; an `error` result carries an `error`.
 */
export type CommandResult = CommandResultOk | CommandResultError;

/** Builds a successful result envelope. */
export function okResult(id: string, result: unknown): CommandResultOk {
  return { id, status: "ok", result };
}

/** Builds a failed result envelope. */
export function errorResult(
  id: string,
  code: ErrorCode,
  message: string,
  details?: unknown,
): CommandResultError {
  const error: CommandError =
    details === undefined ? { code, message } : { code, message, details };
  return { id, status: "error", error };
}
