/**
 * Routes a command to its handler and converts the outcome into a
 * {@link CommandResult} envelope.
 *
 * The dispatcher is the single boundary where a handler's return value or
 * thrown error becomes a wire result — no handler ever builds an envelope
 * itself. An unknown `kind` means the MCP server forwarded a command this pack
 * version does not implement; per design decision A that is reported as
 * `UNSUPPORTED_CAPABILITY` (the pack is older than the server).
 */
import { errorResult, okResult, type Command, type CommandResult } from "../protocol";
import type { HandlerMap, HandlerServices } from "./command-handler";
import { mapError } from "./error-mapping";

export interface Dispatcher {
  /** Executes one command and resolves with its result envelope. Never rejects. */
  dispatch(command: Command): Promise<CommandResult>;
  /** The set of command kinds this dispatcher can route. */
  readonly kinds: readonly string[];
}

/** Creates a {@link Dispatcher} over a frozen handler table. */
export function createDispatcher(handlers: HandlerMap, services: HandlerServices): Dispatcher {
  const kinds = Object.keys(handlers);

  return {
    kinds,
    async dispatch(command: Command): Promise<CommandResult> {
      const handler = handlers[command.kind];
      if (handler === undefined) {
        return errorResult(
          command.id,
          "UNSUPPORTED_CAPABILITY",
          `behavior pack does not implement command kind '${command.kind}'`,
        );
      }
      try {
        const result = await handler(command.payload, {
          ...services,
          deadlineMs: command.deadline_ms,
        });
        return okResult(command.id, result === undefined ? {} : result);
      } catch (error) {
        const mapped = mapError(error);
        services.logger.warn("command handler failed", {
          commandId: command.id,
          kind: command.kind,
          code: mapped.code,
          reason: mapped.message,
        });
        return errorResult(command.id, mapped.code, mapped.message, mapped.details);
      }
    },
  };
}
