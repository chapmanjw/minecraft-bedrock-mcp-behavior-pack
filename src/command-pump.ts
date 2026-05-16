/**
 * Drains received commands and executes them, decoupled from the poll loop.
 *
 * The poll loop only enqueues — it must never wait on command execution, or a
 * slow handler would stall polling and deadlock the bridge. The pump consumes
 * the queue on its own: commands run **serially**, because Script API mutations
 * land in `system.run` ticks where ordering is observable and serial execution
 * keeps watchdog pressure predictable. Per-command cost is absorbed inside
 * handlers via `system.runJob`, not by running handlers concurrently here.
 */
import type { Dispatcher } from "./dispatcher/dispatcher";
import type { Command } from "./protocol";
import type { ResultReporter } from "./result-reporter";
import type { Logger } from "./runtime/logger";

export interface CommandPump {
  /** Enqueues a command for execution. Returns immediately. */
  submit(command: Command): void;
  /** Starts the drain loop. Idempotent. */
  start(): void;
}

export interface CommandPumpDependencies {
  readonly dispatcher: Dispatcher;
  readonly resultReporter: ResultReporter;
  readonly logger: Logger;
}

interface QueuedCommand {
  readonly command: Command;
  readonly receivedAt: number;
}

/** Creates a {@link CommandPump}. */
export function createCommandPump(deps: CommandPumpDependencies): CommandPump {
  const { dispatcher, resultReporter, logger } = deps;
  const queue: QueuedCommand[] = [];
  let wake: (() => void) | null = null;
  let started = false;

  function waitForWork(): Promise<void> {
    return new Promise<void>((resolve) => {
      wake = resolve;
    });
  }

  async function process(entry: QueuedCommand): Promise<void> {
    const { command, receivedAt } = entry;
    // A command dequeued past its deadline has already timed out server-side;
    // skip execution and report the drift. The server discards the late result.
    if (Date.now() - receivedAt > command.deadline_ms) {
      logger.warn("skipping command past its deadline", {
        commandId: command.id,
        kind: command.kind,
        deadlineMs: command.deadline_ms,
      });
      resultReporter.report({
        id: command.id,
        status: "error",
        error: {
          code: "BEHAVIOR_PACK_ERROR",
          message: "command exceeded its deadline before execution",
        },
      });
      return;
    }
    const result = await dispatcher.dispatch(command);
    resultReporter.report(result);
  }

  async function loop(): Promise<void> {
    for (;;) {
      const entry = queue.shift();
      if (entry === undefined) {
        await waitForWork();
        continue;
      }
      try {
        await process(entry);
      } catch (error) {
        // dispatch() never rejects; this guards the pump against the unexpected.
        logger.error("unexpected failure in command pump", {
          commandId: entry.command.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    submit(command: Command): void {
      queue.push({ command, receivedAt: Date.now() });
      if (wake !== null) {
        const resume = wake;
        wake = null;
        resume();
      }
    },
    start(): void {
      if (started) return;
      started = true;
      void loop();
    },
  };
}
