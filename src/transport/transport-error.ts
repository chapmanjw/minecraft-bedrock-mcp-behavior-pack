/**
 * The failure type for every bridge HTTP exchange.
 *
 * A `TransportError` is distinct from a {@link import("../errors/command-error").CommandError}:
 * the latter fails one command, the former fails an exchange with the bridge
 * and drives the poll loop into its backoff state.
 */
export interface TransportErrorOptions {
  /** HTTP status, when the failure was a non-success HTTP response. */
  status?: number;
  /** The underlying thrown value, when the failure was a network exception. */
  cause?: unknown;
}

export class TransportError extends Error {
  /** HTTP status, or `undefined` for a network/parse failure. */
  readonly status: number | undefined;
  readonly cause: unknown;

  constructor(message: string, options: TransportErrorOptions = {}) {
    super(message);
    this.name = "TransportError";
    this.status = options.status;
    this.cause = options.cause;
  }

  /**
   * Whether this failure indicates the server may have restarted and lost the
   * pack's session — the poll loop responds by re-running the handshake.
   */
  get warrantsRehandshake(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 409;
  }
}
