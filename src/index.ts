/**
 * Behavior-pack entrypoint.
 *
 * Boots the bridge client: load configuration, probe capabilities, wire the
 * services, then hand control to the poll-loop state machine. Startup is
 * deferred to a `system.run` callback so the first Script API calls happen in a
 * privileged context once the world is ready.
 */
import { system, world } from "@minecraft/server";
import { createBridgeClient } from "./bridge-client";
import { probeCapabilities } from "./capabilities/capability-probe";
import { createCommandPump } from "./command-pump";
import { ConfigError, loadConfig } from "./config/config";
import { createDispatcher } from "./dispatcher/dispatcher";
import type { HandlerServices } from "./dispatcher/command-handler";
import { buildHandlerRegistry } from "./dispatcher/handlers";
import { createEventPublisher } from "./event-publisher";
import { BEHAVIOR_PACK_VERSION } from "./generated/module-versions";
import { PROTOCOL_VERSION, type HandshakeRequest } from "./protocol";
import { createResultReporter } from "./result-reporter";
import { createJobScheduler } from "./runtime/job-scheduler";
import { createLogger, redactSecret } from "./runtime/logger";
import { createSubscriptionManager } from "./subscriptions/subscription-manager";
import { createHttpTransport } from "./transport/http-transport";
import { resolveWorldId } from "./world-identity";

async function main(): Promise<void> {
  // Configuration first — without it there is nothing to log to and nowhere to
  // connect, so a failure here logs once and stops.
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const reason = error instanceof ConfigError ? error.message : String(error);
    createLogger("error").error("configuration error — the bridge will not start", { reason });
    return;
  }

  const logger = createLogger(config.logLevel);
  redactSecret(config.token);

  const scheduler = createJobScheduler(system);
  const capabilities = probeCapabilities(world, logger.child("capabilities"));
  const transport = createHttpTransport({ baseUrl: config.baseUrl, token: config.token });

  const eventPublisher = createEventPublisher({
    transport,
    scheduler,
    logger: logger.child("events"),
  });
  const subscriptions = createSubscriptionManager({
    world,
    events: eventPublisher,
    logger: logger.child("subscriptions"),
  });
  const resultReporter = createResultReporter({
    transport,
    scheduler,
    logger: logger.child("results"),
  });

  const services: HandlerServices = {
    world,
    scheduler,
    subscriptions,
    events: eventPublisher,
    capabilities,
    logger: logger.child("handler"),
  };
  const dispatcher = createDispatcher(buildHandlerRegistry(), services);
  const commandPump = createCommandPump({
    dispatcher,
    resultReporter,
    logger: logger.child("pump"),
  });

  const worldId = await scheduler.run(() => resolveWorldId(world));
  const handshakeRequest: HandshakeRequest = {
    protocol_version: PROTOCOL_VERSION,
    behavior_pack_version: BEHAVIOR_PACK_VERSION,
    script_modules: capabilities.scriptModules,
    world_id: worldId,
  };

  const client = createBridgeClient({
    transport,
    commandPump,
    scheduler,
    logger: logger.child("bridge"),
    handshakeRequest,
    onHandshakeAccepted: async (accepted) => {
      // Re-arm each subscription the server still considers active, exactly as
      // if it had issued a fresh mc_event_subscribe command.
      for (const subscription of accepted.resync_subscriptions) {
        await scheduler.run(() => {
          try {
            subscriptions.arm(
              subscription.subscription_id,
              subscription.event_type,
              subscription.filter,
            );
          } catch (error) {
            logger.warn("could not re-arm a resynced subscription", {
              subscriptionId: subscription.subscription_id,
              eventType: subscription.event_type,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        });
      }
    },
  });

  logger.info("Bedrock Bridge behavior pack starting", {
    worldId,
    baseUrl: config.baseUrl,
    protocolVersion: PROTOCOL_VERSION,
    behaviorPackVersion: BEHAVIOR_PACK_VERSION,
    commandKinds: dispatcher.kinds.length,
  });
  await client.run();
  logger.info("Bedrock Bridge behavior pack stopped");
}

system.run(() => {
  void main();
});
