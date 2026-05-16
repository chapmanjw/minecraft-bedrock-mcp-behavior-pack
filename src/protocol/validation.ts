/**
 * Runtime decoders for the bridge protocol's *inbound* envelopes — the poll and
 * handshake responses the behavior pack receives.
 *
 * The MCP server validates with `zod`; the behavior pack cannot carry a
 * third-party runtime dependency into a BDS bundle, so this module is a small
 * hand-written equivalent. Outbound envelopes (results, events, the handshake
 * request) are *constructed* by the pack, so their TypeScript types alone
 * guarantee their shape — only inbound envelopes need runtime checking.
 *
 * A decoder throws {@link ProtocolDecodeError} on any mismatch; the transport
 * layer treats that as a transport fault and backs off.
 */
import type { Command, PollResponse } from "./command";
import type { HandshakeResponse, ResyncSubscription } from "./handshake";
import { isCommandId, isSubscriptionId } from "./ids";

/** Thrown when an inbound envelope does not match its expected wire shape. */
export class ProtocolDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolDecodeError";
  }
}

function fail(message: string): never {
  throw new ProtocolDecodeError(message);
}

/** Whether a value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${what} must be an object`);
  return value;
}

function str(object: Record<string, unknown>, key: string, what: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`${what}.${key} must be a non-empty string`);
  }
  return value;
}

function posInt(object: Record<string, unknown>, key: string, what: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`${what}.${key} must be a positive integer`);
  }
  return value;
}

function arr(object: Record<string, unknown>, key: string, what: string): unknown[] {
  const value = object[key];
  if (!Array.isArray(value)) fail(`${what}.${key} must be an array`);
  return value;
}

function bool(object: Record<string, unknown>, key: string, what: string): boolean {
  const value = object[key];
  if (typeof value !== "boolean") fail(`${what}.${key} must be a boolean`);
  return value;
}

/** Decodes a single {@link Command} from `GET /bridge/poll`. */
export function decodeCommand(value: unknown): Command {
  const object = record(value, "command");
  const id = str(object, "id", "command");
  if (!isCommandId(id)) fail(`command.id '${id}' is not a cmd_<ULID> identifier`);
  return {
    id,
    kind: str(object, "kind", "command"),
    payload: object["payload"],
    issued_at: str(object, "issued_at", "command"),
    deadline_ms: posInt(object, "deadline_ms", "command"),
  };
}

/** Decodes the {@link PollResponse} envelope from `GET /bridge/poll`. */
export function decodePollResponse(value: unknown): PollResponse {
  const object = record(value, "poll response");
  return {
    commands: arr(object, "commands", "poll response").map(decodeCommand),
    server_time: str(object, "server_time", "poll response"),
  };
}

function decodeResyncSubscription(value: unknown): ResyncSubscription {
  const object = record(value, "resync subscription");
  const subscriptionId = str(object, "subscription_id", "resync subscription");
  if (!isSubscriptionId(subscriptionId)) {
    fail(`resync subscription_id '${subscriptionId}' is not a sub_<ULID> identifier`);
  }
  const base = {
    subscription_id: subscriptionId,
    event_type: str(object, "event_type", "resync subscription"),
  };
  return "filter" in object ? { ...base, filter: object["filter"] } : base;
}

/** Decodes the {@link HandshakeResponse} envelope from `POST /bridge/handshake`. */
export function decodeHandshakeResponse(value: unknown): HandshakeResponse {
  const object = record(value, "handshake response");
  const accepted = bool(object, "accepted", "handshake response");
  if (!accepted) {
    return {
      accepted: false,
      reason: str(object, "reason", "handshake response"),
      server_protocol_version: str(object, "server_protocol_version", "handshake response"),
    };
  }
  return {
    accepted: true,
    server_version: str(object, "server_version", "handshake response"),
    protocol_version: str(object, "protocol_version", "handshake response"),
    poll_timeout_ms: posInt(object, "poll_timeout_ms", "handshake response"),
    resync_subscriptions: arr(object, "resync_subscriptions", "handshake response").map(
      decodeResyncSubscription,
    ),
  };
}
