/**
 * The startup handshake between the behavior pack and the MCP server —
 * `POST /bridge/handshake`.
 *
 * Wire shapes mirror `protocol/handshake.ts` in the MCP server repository.
 */

/** A Script API module the behavior pack depends on. */
export interface ScriptModule {
  readonly name: string;
  readonly version: string;
}

/**
 * The request envelope for `POST /bridge/handshake`, sent on pack startup.
 *
 * The reported Script API module versions drive server-side capability
 * negotiation.
 */
export interface HandshakeRequest {
  /** Bridge protocol version the behavior pack implements. */
  readonly protocol_version: string;
  /** Version of the behavior pack itself. */
  readonly behavior_pack_version: string;
  /** Minecraft / BDS version, when the behavior pack can determine it. */
  readonly minecraft_version?: string;
  /** Script API modules and versions the behavior pack loaded. */
  readonly script_modules: readonly ScriptModule[];
  /** Stable identifier of the world the behavior pack is running in. */
  readonly world_id: string;
}

/**
 * A subscription the server asks the behavior pack to re-arm.
 *
 * A pack restart loses its Script API subscriptions; the handshake response
 * replays the still-active ones so events resume without client involvement.
 */
export interface ResyncSubscription {
  readonly subscription_id: string;
  readonly event_type: string;
  readonly filter?: unknown;
}

/** The handshake was accepted — the pack may start the poll loop. */
export interface HandshakeAccepted {
  readonly accepted: true;
  /** Version of the MCP server. */
  readonly server_version: string;
  /** Bridge protocol version the server implements. */
  readonly protocol_version: string;
  /** Long-poll timeout the pack should use for `GET /bridge/poll`. */
  readonly poll_timeout_ms: number;
  /** Subscriptions to re-arm after a restart. */
  readonly resync_subscriptions: readonly ResyncSubscription[];
}

/** The handshake was refused — incompatible bridge protocol major version. */
export interface HandshakeRefused {
  readonly accepted: false;
  /** Human-readable reason the connection was refused. */
  readonly reason: string;
  /** Bridge protocol version the server implements, for diagnostics. */
  readonly server_protocol_version: string;
}

/**
 * The response envelope for `POST /bridge/handshake` — a discriminated union on
 * `accepted`.
 */
export type HandshakeResponse = HandshakeAccepted | HandshakeRefused;
