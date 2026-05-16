/**
 * World events reported by the behavior pack to `POST /bridge/event`.
 *
 * Wire shapes mirror `protocol/event.ts` in the MCP server repository.
 */

/** A world event observed for an active subscription. */
export interface BridgeEvent {
  /** The subscription this event belongs to. */
  readonly subscription_id: string;
  /** Event type, e.g. `playerJoin` or `playerBreakBlock`. */
  readonly event_type: string;
  /** ISO-8601 timestamp at which the event occurred in-world. */
  readonly occurred_at: string;
  /** Event-specific data. */
  readonly payload: unknown;
}

/** The smallest event batch the server accepts. */
export const EVENT_BATCH_MIN = 1;
/** The largest event batch the server accepts. */
export const EVENT_BATCH_MAX = 256;

/**
 * The request envelope for `POST /bridge/event`.
 *
 * Events are batched: bursts (e.g. `playerBreakBlock`) would overwhelm the
 * bridge one request per event. A batch holds between {@link EVENT_BATCH_MIN}
 * and {@link EVENT_BATCH_MAX} events.
 */
export interface EventReport {
  readonly events: readonly BridgeEvent[];
}
