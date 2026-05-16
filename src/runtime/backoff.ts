/**
 * Exponential backoff with full jitter, capped at a small maximum.
 *
 * Shared by the poll loop and the event publisher: every retry against an
 * unreachable bridge waits a jittered, exponentially growing interval so a
 * fleet of behavior packs does not reconnect in lockstep.
 */

export interface Backoff {
  /** The delay to wait before the next attempt, in milliseconds. */
  nextDelayMs(): number;
  /** Resets the sequence after a successful attempt. */
  reset(): void;
  /** The number of consecutive failures since the last reset. */
  readonly failureCount: number;
}

export interface BackoffOptions {
  /** Delay for the first retry, before jitter. Default 250ms. */
  readonly baseMs?: number;
  /** Ceiling for the delay, before jitter. Default 5000ms. */
  readonly maxMs?: number;
}

/** Creates an independent {@link Backoff} sequence. */
export function createBackoff(options: BackoffOptions = {}): Backoff {
  const baseMs = options.baseMs ?? 250;
  const maxMs = options.maxMs ?? 5_000;
  let attempts = 0;

  return {
    get failureCount(): number {
      return attempts;
    },
    reset(): void {
      attempts = 0;
    },
    nextDelayMs(): number {
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempts);
      attempts += 1;
      // Full jitter: a uniform sample in [0, ceiling].
      return Math.round(Math.random() * ceiling);
    },
  };
}
