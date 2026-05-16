// Shared test doubles. These are deterministic, in-memory stand-ins for the
// runtime services — no Script API, no timers, no network.

import type { JobScheduler } from "../../src/runtime/job-scheduler";
import type { Logger } from "../../src/runtime/logger";

/** A logger that records every line, for assertions, and is otherwise silent. */
export interface RecordingLogger extends Logger {
  readonly lines: { level: string; message: string }[];
}

export function createRecordingLogger(): RecordingLogger {
  const lines: { level: string; message: string }[] = [];
  const make = (): RecordingLogger => {
    const logger: RecordingLogger = {
      lines,
      error: (message) => lines.push({ level: "error", message }),
      warn: (message) => lines.push({ level: "warn", message }),
      info: (message) => lines.push({ level: "info", message }),
      debug: (message) => lines.push({ level: "debug", message }),
      child: () => logger,
    };
    return logger;
  };
  return make();
}

/**
 * A synchronous {@link JobScheduler}: `run` and `runJob` execute immediately,
 * `delay` resolves on the microtask queue, and the tick counter is advanceable.
 */
export interface FakeScheduler extends JobScheduler {
  advanceTick(by?: number): void;
}

export function createFakeScheduler(): FakeScheduler {
  let tick = 0;
  return {
    run<T>(task: () => T): Promise<T> {
      try {
        return Promise.resolve(task());
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    runJob<T>(task: () => Generator<void, T, void>): Promise<T> {
      try {
        const generator = task();
        let step = generator.next();
        while (!step.done) step = generator.next();
        return Promise.resolve(step.value);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    delay(): Promise<void> {
      return Promise.resolve();
    },
    currentTick(): number {
      return tick;
    },
    advanceTick(by = 1): void {
      tick += by;
    },
  };
}

/** Drains the microtask queue so pending async work settles before assertions. */
export async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
  }
}
