/**
 * Commands delivered to the behavior pack by `GET /bridge/poll`.
 *
 * Wire shapes mirror `protocol/command.ts` in the MCP server repository.
 */

/**
 * A single command to execute.
 *
 * `payload` is opaque at the protocol layer — the MCP server already validated
 * it against the originating tool's schema, and each handler re-validates it
 * against its own expected shape before use.
 */
export interface Command {
  /** Correlation identifier (`cmd_<ULID>`). */
  readonly id: string;
  /** Command kind — the originating MCP tool name, e.g. `mc_block_set`. */
  readonly kind: string;
  /** Command arguments, validated per-kind by the handler. */
  readonly payload: unknown;
  /** ISO-8601 timestamp at which the server issued the command. */
  readonly issued_at: string;
  /** Milliseconds of execution budget remaining when the command was delivered. */
  readonly deadline_ms: number;
}

/**
 * The response envelope for `GET /bridge/poll`.
 *
 * An empty `commands` array means the long poll timed out with no work.
 */
export interface PollResponse {
  /** Commands to execute; empty when the long poll timed out. */
  readonly commands: readonly Command[];
  /** ISO-8601 server timestamp, for clock-skew diagnostics. */
  readonly server_time: string;
}
