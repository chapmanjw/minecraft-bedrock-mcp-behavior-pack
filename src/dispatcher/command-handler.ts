/**
 * The contract every command handler implements.
 *
 * A handler is pure with respect to its `payload`: it reads the payload, drives
 * the Script API through the services on its {@link HandlerContext}, and either
 * returns the value to serialize as the result or throws a
 * {@link import("../errors/command-error").CommandError}. Handlers never touch
 * `system`, the transport, or the network directly — every side effect goes
 * through a named service.
 */
import type { World } from "@minecraft/server";
import type { CapabilityReport } from "../capabilities/capability-probe";
import type { EventPublisher } from "../event-publisher";
import type { JobScheduler } from "../runtime/job-scheduler";
import type { Logger } from "../runtime/logger";
import type { SubscriptionManager } from "../subscriptions/subscription-manager";

/** Long-lived services shared by every handler invocation. */
export interface HandlerServices {
  /** The Script API world singleton. */
  readonly world: World;
  /** The sole gateway to the Script API execution context. */
  readonly scheduler: JobScheduler;
  /** Registers and tears down event subscriptions. */
  readonly subscriptions: SubscriptionManager;
  /** Buffers world events for delivery to the bridge. */
  readonly events: EventPublisher;
  /** Negotiated Script API capabilities. */
  readonly capabilities: CapabilityReport;
  /** Scoped logger. */
  readonly logger: Logger;
}

/** Per-invocation context: the shared services plus this command's budget. */
export interface HandlerContext extends HandlerServices {
  /** Milliseconds of execution budget the server granted this command. */
  readonly deadlineMs: number;
}

/**
 * A command handler. Returns the value serialized into the result envelope's
 * `result` field, or throws a `CommandError` to fail the command.
 */
export type CommandHandler = (payload: unknown, context: HandlerContext) => Promise<unknown>;

/** A `kind` → handler lookup table contributed by a domain module. */
export type HandlerMap = Readonly<Record<string, CommandHandler>>;
