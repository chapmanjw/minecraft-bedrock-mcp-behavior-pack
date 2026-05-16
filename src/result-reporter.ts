/**
 * Posts each command's result to `POST /bridge/result`.
 *
 * Reporting is buffered and retried so a brief bridge outage does not lose a
 * result. A result for a command the server has already timed out is harmless —
 * the server acknowledges and discards it — so retries are always safe. The
 * buffer is capped; past the cap the oldest results are dropped, since their
 * commands have necessarily timed out server-side anyway.
 */
import type { CommandResult } from "./protocol";
import { createBackoff } from "./runtime/backoff";
import type { JobScheduler } from "./runtime/job-scheduler";
import type { Logger } from "./runtime/logger";
import type { BridgeTransport } from "./transport/http-transport";

/** Hard cap on buffered results; the oldest are dropped beyond it. */
const BUFFER_CAP = 512;

export interface ResultReporter {
  /** Buffers a result for delivery. Never throws; never blocks. */
  report(result: CommandResult): void;
}

export interface ResultReporterDependencies {
  readonly transport: BridgeTransport;
  readonly scheduler: JobScheduler;
  readonly logger: Logger;
}

/** Creates a {@link ResultReporter}. */
export function createResultReporter(deps: ResultReporterDependencies): ResultReporter {
  const { transport, scheduler, logger } = deps;
  const backoff = createBackoff();

  const buffer: CommandResult[] = [];
  let draining = false;

  async function drain(): Promise<void> {
    draining = true;
    try {
      while (buffer.length > 0) {
        const next = buffer[0];
        if (next === undefined) break;
        try {
          await transport.reportResult(next);
          buffer.shift();
          backoff.reset();
        } catch (error) {
          const delayMs = backoff.nextDelayMs();
          logger.warn("result delivery failed; will retry", {
            commandId: next.id,
            buffered: buffer.length,
            failures: backoff.failureCount,
            delayMs,
            reason: error instanceof Error ? error.message : String(error),
          });
          await scheduler.delay(delayMs);
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    report(result: CommandResult): void {
      if (buffer.length >= BUFFER_CAP) {
        const dropped = buffer.shift();
        logger.warn("result buffer at capacity; dropping oldest result", {
          droppedCommandId: dropped?.id,
        });
      }
      buffer.push(result);
      if (!draining) void drain();
    },
  };
}
