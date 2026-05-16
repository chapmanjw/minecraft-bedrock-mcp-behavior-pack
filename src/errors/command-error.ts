/**
 * The error a command handler throws to fail a command with a stable,
 * machine-readable code.
 *
 * The dispatcher catches a `CommandError` and converts it directly into the
 * `error` envelope of a `CommandResult`. Any other thrown value is mapped to a
 * code by the dispatcher's error table; handlers should prefer throwing a
 * `CommandError` so the code is intentional rather than inferred.
 */
import type { ErrorCode } from "../protocol";

export class CommandError extends Error {
  readonly code: ErrorCode;
  /** Optional structured context, surfaced in the result envelope's `details`. */
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }

  /** The command payload failed the handler's local validation. */
  static invalidInput(message: string, details?: unknown): CommandError {
    return new CommandError("INVALID_INPUT", message, details);
  }

  /** A referenced entity, structure, or other resource does not exist. */
  static notFound(message: string, details?: unknown): CommandError {
    return new CommandError("NOT_FOUND", message, details);
  }

  /** A required Script API module or feature is unavailable in this BDS build. */
  static unsupported(message: string, details?: unknown): CommandError {
    return new CommandError("UNSUPPORTED_CAPABILITY", message, details);
  }

  /** The Script API threw or returned an unexpected condition. */
  static behaviorPack(message: string, details?: unknown): CommandError {
    return new CommandError("BEHAVIOR_PACK_ERROR", message, details);
  }

  /** An unexpected internal failure. */
  static internal(message: string, details?: unknown): CommandError {
    return new CommandError("INTERNAL", message, details);
  }
}

/** Whether a thrown value is a {@link CommandError}. */
export function isCommandError(value: unknown): value is CommandError {
  return value instanceof CommandError;
}
