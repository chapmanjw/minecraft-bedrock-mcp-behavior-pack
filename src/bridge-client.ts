/**
 * The poll-loop state machine — the heart of the behavior pack.
 *
 * ```
 *   Handshaking ──200──▶ Polling ──┐
 *      │  ▲                 │      │ 200: enqueue commands, re-poll at once
 *      │  └── refused ───────┼──────┘
 *    409▼          re-handshake on 401/403/409 or sustained failure
 *   Stopped ◀── log the reason; never loop a refused major version
 * ```
 *
 * The loop holds a single in-flight poll and never waits on command execution —
 * received commands are handed to the {@link CommandPump} and the loop polls
 * again immediately, so a slow handler can never deadlock the bridge. Transport
 * failures back off with jitter and never abandon the bridge.
 */
import type { CommandPump } from "./command-pump";
import type { HandshakeAccepted, HandshakeRequest } from "./protocol";
import { createBackoff } from "./runtime/backoff";
import type { JobScheduler } from "./runtime/job-scheduler";
import type { Logger } from "./runtime/logger";
import type { BridgeTransport } from "./transport/http-transport";
import { TransportError } from "./transport/transport-error";

/** Re-run the handshake once consecutive poll failures reach this count. */
const REHANDSHAKE_AFTER_POLL_FAILURES = 6;
/** Escalate poll-failure logs from `warn` to `error` every this-many failures. */
const LOUD_FAILURE_INTERVAL = 5;

export interface BridgeClient {
  /**
   * Runs the loop until the bridge refuses the handshake (an incompatible
   * protocol major version). Resolves only on that terminal state.
   */
  run(): Promise<void>;
}

export interface BridgeClientDependencies {
  readonly transport: BridgeTransport;
  readonly commandPump: CommandPump;
  readonly scheduler: JobScheduler;
  readonly logger: Logger;
  /** The handshake request for this session — built once at startup. */
  readonly handshakeRequest: HandshakeRequest;
  /** Re-arms the subscriptions the server asks to resync, after acceptance. */
  readonly onHandshakeAccepted: (accepted: HandshakeAccepted) => Promise<void> | void;
}

/** Creates the {@link BridgeClient} poll-loop state machine. */
export function createBridgeClient(deps: BridgeClientDependencies): BridgeClient {
  const { transport, commandPump, scheduler, logger, handshakeRequest, onHandshakeAccepted } = deps;

  /** Handshaking state: resolves to the acceptance, or `null` when refused. */
  async function handshake(): Promise<HandshakeAccepted | null> {
    const backoff = createBackoff();
    for (;;) {
      try {
        const response = await transport.handshake(handshakeRequest);
        if (!response.accepted) {
          logger.error("bridge refused the behavior pack — the poll loop will not start", {
            reason: response.reason,
            serverProtocolVersion: response.server_protocol_version,
            packProtocolVersion: handshakeRequest.protocol_version,
          });
          return null;
        }
        logger.info("handshake accepted", {
          serverVersion: response.server_version,
          pollTimeoutMs: response.poll_timeout_ms,
          resyncSubscriptions: response.resync_subscriptions.length,
        });
        return response;
      } catch (error) {
        const delayMs = backoff.nextDelayMs();
        logger.warn("handshake failed; retrying", {
          failures: backoff.failureCount,
          delayMs,
          reason: error instanceof Error ? error.message : String(error),
        });
        await scheduler.delay(delayMs);
      }
    }
  }

  /** Polling state: loops until a re-handshake is warranted. */
  async function poll(): Promise<void> {
    const backoff = createBackoff();
    for (;;) {
      try {
        const response = await transport.poll();
        backoff.reset();
        if (response.commands.length > 0) {
          logger.debug("received commands", { count: response.commands.length });
          for (const command of response.commands) {
            commandPump.submit(command);
          }
        }
        // Re-poll immediately — empty batches are normal long-poll timeouts.
      } catch (error) {
        if (error instanceof TransportError && error.warrantsRehandshake) {
          logger.warn("poll indicates a lost session; re-running handshake", {
            status: error.status,
          });
          return;
        }
        const delayMs = backoff.nextDelayMs();
        const failures = backoff.failureCount;
        const reason = error instanceof Error ? error.message : String(error);
        if (failures % LOUD_FAILURE_INTERVAL === 0) {
          logger.error("bridge poll has failed repeatedly", { failures, reason });
        } else {
          logger.warn("poll failed; backing off", { failures, delayMs, reason });
        }
        await scheduler.delay(delayMs);
        if (failures >= REHANDSHAKE_AFTER_POLL_FAILURES) {
          logger.warn("re-running handshake after sustained poll failures", { failures });
          return;
        }
      }
    }
  }

  return {
    async run(): Promise<void> {
      commandPump.start();
      for (;;) {
        const accepted = await handshake();
        if (accepted === null) return;
        transport.setPollTimeoutMs(accepted.poll_timeout_ms);
        await onHandshakeAccepted(accepted);
        await poll();
        // poll() returned — fall through and re-handshake.
      }
    },
  };
}
