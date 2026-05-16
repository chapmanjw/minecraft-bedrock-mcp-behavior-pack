/**
 * The behavior pack's single gateway to the Script API execution context.
 *
 * Code resumed from an awaited promise — the continuation after an HTTP poll,
 * for instance — runs in a context where world mutation is restricted. Every
 * Script API touch a handler makes is therefore routed through this scheduler:
 *
 * - {@link JobScheduler.run} defers a unit of work to `system.run`, which the
 *   engine executes in a privileged tick context.
 * - {@link JobScheduler.runJob} drives a generator with `system.runJob` so a
 *   long sweep (filling thousands of blocks) yields between ticks and never
 *   trips the script watchdog.
 * - {@link JobScheduler.delay} schedules a tick-accurate delay, used for
 *   reconnection backoff — the runtime has no `setTimeout`.
 */
import type { System } from "@minecraft/server";

/** BDS runs the world simulation at a fixed 20 ticks per second. */
const TICKS_PER_SECOND = 20;

export interface JobScheduler {
  /** Runs `task` in a privileged tick context and resolves with its return. */
  run<T>(task: () => T): Promise<T>;
  /**
   * Drives a generator across ticks via `system.runJob`, resolving with the
   * generator's return value. Yield periodically to stay under the watchdog.
   */
  runJob<T>(task: () => Generator<void, T, void>): Promise<T>;
  /** Resolves after at least `ms` milliseconds, rounded up to whole ticks. */
  delay(ms: number): Promise<void>;
  /** The current world tick — a monotonically increasing counter. */
  currentTick(): number;
}

/** Creates a {@link JobScheduler} backed by the Script API `system` singleton. */
export function createJobScheduler(system: System): JobScheduler {
  return {
    run<T>(task: () => T): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        system.run(() => {
          try {
            resolve(task());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    },

    runJob<T>(task: () => Generator<void, T, void>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        function* driver(): Generator<void, void, void> {
          try {
            resolve(yield* task());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
        system.runJob(driver());
      });
    },

    delay(ms: number): Promise<void> {
      const ticks = Math.max(1, Math.ceil((ms / 1000) * TICKS_PER_SECOND));
      return new Promise<void>((resolve) => {
        system.runTimeout(resolve, ticks);
      });
    },

    currentTick(): number {
      return system.currentTick;
    },
  };
}
