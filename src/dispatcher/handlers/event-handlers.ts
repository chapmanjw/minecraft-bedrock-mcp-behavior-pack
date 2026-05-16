/**
 * Event-subscription lifecycle handlers.
 *
 * `mc_event_subscribe` arms a Script API listener and tags fired events with
 * the server-issued `subscription_id`. `mc_event_unsubscribe` tears the
 * listener down and is idempotent — unsubscribing twice is not an error. The
 * actual event delivery runs through the {@link SubscriptionManager} and the
 * {@link EventPublisher}; these handlers only manage the listener lifecycle.
 */
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";

const subscribe: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_event_subscribe");
  const subscriptionId = reader.string("subscription_id");
  const eventType = reader.string("event_type");
  const filter = reader.raw("filter");
  return ctx.scheduler.run(() => {
    ctx.subscriptions.arm(subscriptionId, eventType, filter);
    return {};
  });
};

const unsubscribe: CommandHandler = (payload, ctx) => {
  const subscriptionId = PayloadReader.open(payload, "mc_event_unsubscribe").string(
    "subscription_id",
  );
  return ctx.scheduler.run(() => {
    ctx.subscriptions.disarm(subscriptionId);
    return {};
  });
};

/** The event-domain handler table. */
export const eventHandlers: HandlerMap = {
  mc_event_subscribe: subscribe,
  mc_event_unsubscribe: unsubscribe,
};
