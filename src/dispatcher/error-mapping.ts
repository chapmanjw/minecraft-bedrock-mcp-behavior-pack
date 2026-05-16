/**
 * Maps a thrown value to a stable behavior-pack error code.
 *
 * A {@link CommandError} carries its own intentional code. Anything else — most
 * often a typed Script API error — is matched by its error name against the
 * table below; unrecognized errors fall back to `BEHAVIOR_PACK_ERROR`, and a
 * non-`Error` throw to `INTERNAL`.
 */
import { isCommandError } from "../errors/command-error";
import type { ErrorCode } from "../protocol";

/** A thrown value reduced to the fields of an error result envelope. */
export interface MappedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: unknown;
}

/**
 * Script API error type names mapped to behavior-pack codes. The Script API
 * names these errors stably; an out-of-bounds location or a bad entity query is
 * a client mistake (`INVALID_INPUT`), a missing entity or structure is
 * `NOT_FOUND`, and an unloaded chunk is a transient world condition.
 */
const SCRIPT_API_ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  LocationOutOfWorldBoundariesError: "INVALID_INPUT",
  ArgumentOutOfBoundsError: "INVALID_INPUT",
  PropertyOutOfBoundsError: "INVALID_INPUT",
  EntityQueryError: "INVALID_INPUT",
  NamespaceNameError: "INVALID_INPUT",
  InvalidContainerSlotError: "INVALID_INPUT",
  InvalidArgumentError: "INVALID_INPUT",
  InvalidEntityError: "NOT_FOUND",
  InvalidStructureError: "NOT_FOUND",
  LocationInUnloadedChunkError: "BEHAVIOR_PACK_ERROR",
  UnloadedChunksError: "BEHAVIOR_PACK_ERROR",
};

/** Reduces any thrown value to a {@link MappedError}. */
export function mapError(error: unknown): MappedError {
  if (isCommandError(error)) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) {
    const mapped = SCRIPT_API_ERROR_CODES[error.name];
    return {
      code: mapped ?? "BEHAVIOR_PACK_ERROR",
      message: error.message.length > 0 ? error.message : error.name,
      details: undefined,
    };
  }
  return {
    code: "INTERNAL",
    message: `non-error value thrown: ${String(error)}`,
    details: undefined,
  };
}
