/**
 * Buffers world events and posts them to `POST /bridge/event` in batches.
 *
 * Batching policy: a flush fires when the buffer reaches {@link SOFT_BATCH_SIZE}
 * events, or when {@link ACCUMULATION_WINDOW_MS} elapses after the first
 * un-flushed event — whichever comes first. A single request carries at most
 * {@link EVENT_BATCH_MAX} events (the protocol ceiling).
 *
 * Back-pressure: events are best-effort. If the bridge is unreachable the
 * publisher retries with jittered backoff while new events keep buffering; past
 * {@link BUFFER_CAP} the oldest events are dropped so a wedged bridge can never
 * exhaust memory or stall a handler. `enqueue` never throws and never blocks.
 */
import { EVENT_BATCH_MAX, type BridgeEvent, type EventReport } from "./protocol";
import { createBackoff } from "./runtime/backoff";
import type { JobScheduler } from "./runtime/job-scheduler";
import type { Logger } from "./runtime/logger";
import type { BridgeTransport } from "./transport/http-transport";

/** Flush as soon as this many events are buffered. */
const SOFT_BATCH_SIZE = 64;
/** Otherwise, flush this long after the first un-flushed event. */
const ACCUMULATION_WINDOW_MS = 100;
/** Hard cap on buffered events; the oldest are dropped beyond it. */
const BUFFER_CAP = 2_048;

export interface EventPublisher {
  /** Buffers an event for delivery. Never throws; never blocks. */
  enqueue(event: BridgeEvent): void;
}

export interface EventPublisherDependencies {
  readonly transport: BridgeTransport;
  readonly scheduler: JobScheduler;
  readonly logger: Logger;
}

/** Creates an {@link EventPublisher}. */
export function createEventPublisher(deps: EventPublisherDependencies): EventPublisher {
  const { transport, scheduler, logger } = deps;
  const backoff = createBackoff();

  let buffer: BridgeEvent[] = [];
  let draining = false;
  let windowScheduled = false;
  let dropped = 0;

  async function drain(): Promise<void> {
    draining = true;
    try {
      while (buffer.length > 0) {
        const batch = buffer.slice(0, EVENT_BATCH_MAX);
        const report: EventReport = { events: batch };
        try {
          await transport.reportEvents(report);
          buffer = buffer.slice(batch.length);
          backoff.reset();
        } catch (error) {
          const delayMs = backoff.nextDelayMs();
          logger.warn("event delivery failed; will retry", {
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

  function startDrain(): void {
    if (draining) return;
    void drain();
  }

  return {
    enqueue(event: BridgeEvent): void {
      if (buffer.length >= BUFFER_CAP) {
        buffer.shift();
        dropped += 1;
        if (dropped % 256 === 1) {
          logger.warn("event buffer at capacity; dropping oldest events", { dropped });
        }
      }
      buffer.push(event);

      if (buffer.length >= SOFT_BATCH_SIZE) {
        startDrain();
        return;
      }
      if (!windowScheduled && !draining) {
        windowScheduled = true;
        void scheduler.delay(ACCUMULATION_WINDOW_MS).then(() => {
          windowScheduled = false;
          startDrain();
        });
      }
    },
  };
}
