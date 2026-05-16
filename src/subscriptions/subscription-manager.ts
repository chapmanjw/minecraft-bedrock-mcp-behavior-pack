/**
 * Tracks active Script API event listeners, indexed by `subscription_id`.
 *
 * Script API subscriptions do not survive a script reload, so this manager
 * holds no persistent state — the MCP server replays the active set through the
 * handshake's `resync_subscriptions`, and the entrypoint re-arms each one.
 */
import type { World } from "@minecraft/server";
import { CommandError } from "../errors/command-error";
import type { EventPublisher } from "../event-publisher";
import type { BridgeEvent } from "../protocol";
import type { Logger } from "../runtime/logger";
import { getEventBinding } from "./event-bindings";

/** A subscription summary, for diagnostics. */
export interface SubscriptionSummary {
  readonly id: string;
  readonly eventType: string;
}

export interface SubscriptionManager {
  /**
   * Registers a Script API listener for `subscriptionId`. Throws
   * `UNSUPPORTED_CAPABILITY` if the event type has no binding. Re-arming an
   * already-active id is a no-op.
   */
  arm(subscriptionId: string, eventType: string, filter: unknown): void;
  /** Removes a listener. Returns whether one was active. Idempotent. */
  disarm(subscriptionId: string): boolean;
  /** Whether a subscription is currently armed. */
  has(subscriptionId: string): boolean;
  /** A snapshot of active subscriptions. */
  list(): SubscriptionSummary[];
}

interface ArmedSubscription {
  readonly eventType: string;
  readonly unsubscribe: () => void;
}

/** Structural equality for filter matching — primitives, arrays, plain objects. */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObject = a as Record<string, unknown>;
    const bObject = b as Record<string, unknown>;
    const keys = Object.keys(aObject);
    if (keys.length !== Object.keys(bObject).length) return false;
    return keys.every((key) => deepEquals(aObject[key], bObject[key]));
  }
  return false;
}

/**
 * Whether a projected event payload satisfies a subscription filter. An absent
 * or empty filter matches everything; otherwise every filter key must equal the
 * corresponding payload field.
 */
function matchesFilter(payload: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true;
  if (typeof filter !== "object" || Array.isArray(filter)) return true;
  if (typeof payload !== "object" || payload === null) return false;
  const payloadObject = payload as Record<string, unknown>;
  return Object.entries(filter as Record<string, unknown>).every(([key, value]) =>
    deepEquals(payloadObject[key], value),
  );
}

export interface SubscriptionManagerDependencies {
  readonly world: World;
  readonly events: EventPublisher;
  readonly logger: Logger;
}

/** Creates a {@link SubscriptionManager}. */
export function createSubscriptionManager(
  deps: SubscriptionManagerDependencies,
): SubscriptionManager {
  const { world, events, logger } = deps;
  const armed = new Map<string, ArmedSubscription>();

  return {
    arm(subscriptionId, eventType, filter): void {
      if (armed.has(subscriptionId)) {
        logger.debug("subscription already armed; ignoring", { subscriptionId, eventType });
        return;
      }
      const binding = getEventBinding(eventType);
      if (binding === undefined) {
        throw CommandError.unsupported(`no event binding for event type '${eventType}'`);
      }
      const unsubscribe = binding.subscribe(world, (payload) => {
        // Tolerate the unsubscribe race: drop events for a no-longer-armed id.
        if (!armed.has(subscriptionId)) return;
        if (!matchesFilter(payload, filter)) return;
        const event: BridgeEvent = {
          subscription_id: subscriptionId,
          event_type: eventType,
          occurred_at: new Date().toISOString(),
          payload,
        };
        events.enqueue(event);
      });
      armed.set(subscriptionId, { eventType, unsubscribe });
      logger.info("subscription armed", { subscriptionId, eventType, mode: binding.mode });
    },

    disarm(subscriptionId): boolean {
      const subscription = armed.get(subscriptionId);
      if (subscription === undefined) return false;
      armed.delete(subscriptionId);
      try {
        subscription.unsubscribe();
      } catch (error) {
        logger.warn("error while unsubscribing a Script API listener", {
          subscriptionId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      logger.info("subscription disarmed", { subscriptionId });
      return true;
    },

    has(subscriptionId): boolean {
      return armed.has(subscriptionId);
    },

    list(): SubscriptionSummary[] {
      return [...armed.entries()].map(([id, subscription]) => ({
        id,
        eventType: subscription.eventType,
      }));
    },
  };
}
