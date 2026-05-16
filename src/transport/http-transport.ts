/**
 * The bridge transport — the behavior pack's HTTP I/O against the four
 * `/bridge/*` routes, built on `@minecraft/server-net`.
 *
 * This module owns sockets, headers, and JSON; it owns no policy. The poll loop
 * ({@link import("../bridge-client").BridgeClient}) owns retries and state, and
 * depends only on the {@link BridgeTransport} interface — so the loop is tested
 * against an in-memory fake with no `server-net` involvement.
 */
import type { SecretString } from "@minecraft/server-admin";
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";
import {
  decodeHandshakeResponse,
  decodePollResponse,
  ProtocolDecodeError,
  type CommandResult,
  type EventReport,
  type HandshakeRequest,
  type HandshakeResponse,
  type PollResponse,
} from "../protocol";
import { TransportError } from "./transport-error";

/** The four exchanges the behavior pack has with the bridge. */
export interface BridgeTransport {
  /** `POST /bridge/handshake` — negotiate protocol version, fetch resync list. */
  handshake(request: HandshakeRequest): Promise<HandshakeResponse>;
  /** `GET /bridge/poll` — long-poll for a batch of commands. */
  poll(): Promise<PollResponse>;
  /** `POST /bridge/result` — settle one command. */
  reportResult(result: CommandResult): Promise<void>;
  /** `POST /bridge/event` — deliver a batch of world events. */
  reportEvents(report: EventReport): Promise<void>;
  /** Updates the long-poll hold time, negotiated at handshake. */
  setPollTimeoutMs(pollTimeoutMs: number): void;
}

export interface HttpTransportConfig {
  /** Bridge base URL, e.g. `http://localhost:8765`. */
  readonly baseUrl: string;
  /** The bridge `Authorization` header value, as an opaque `SecretString`. */
  readonly token: SecretString;
}

/** Seconds added to the negotiated poll timeout before the socket gives up. */
const POLL_TIMEOUT_MARGIN_SECONDS = 10;
/** Request timeout for the short, non-polling exchanges. */
const SHORT_TIMEOUT_SECONDS = 15;
/** Poll timeout used until the handshake negotiates the real value. */
const DEFAULT_POLL_TIMEOUT_MS = 30_000;

/** Creates the `server-net`-backed {@link BridgeTransport}. */
export function createHttpTransport(config: HttpTransportConfig): BridgeTransport {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  let pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS;

  function buildRequest(
    method: HttpRequestMethod,
    path: string,
    timeoutSeconds: number,
    body?: unknown,
  ): HttpRequest {
    const request = new HttpRequest(`${baseUrl}${path}`);
    request.method = method;
    request.timeout = timeoutSeconds;
    request.headers = [
      // The token is an opaque SecretString resolved into the header at send
      // time; it already carries the `Bearer ` scheme (see config.readToken).
      new HttpHeader("Authorization", config.token),
      new HttpHeader("Accept", "application/json"),
      ...(body === undefined ? [] : [new HttpHeader("Content-Type", "application/json")]),
    ];
    if (body !== undefined) request.body = JSON.stringify(body);
    return request;
  }

  async function send(
    method: HttpRequestMethod,
    path: string,
    timeoutSeconds: number,
    body?: unknown,
  ): Promise<{ status: number; body: string }> {
    try {
      const response = await http.request(buildRequest(method, path, timeoutSeconds, body));
      return { status: response.status, body: response.body };
    } catch (error) {
      throw new TransportError(`network failure on ${method} ${path}`, { cause: error });
    }
  }

  function parseJson(body: string, path: string): unknown {
    try {
      return JSON.parse(body) as unknown;
    } catch (error) {
      throw new TransportError(`malformed JSON in ${path} response`, { cause: error });
    }
  }

  return {
    setPollTimeoutMs(value: number): void {
      pollTimeoutMs = value;
    },

    async handshake(request: HandshakeRequest): Promise<HandshakeResponse> {
      const { status, body } = await send(
        HttpRequestMethod.Post,
        "/bridge/handshake",
        SHORT_TIMEOUT_SECONDS,
        request,
      );
      // 200 (accepted) and 409 (refused) both carry a valid handshake envelope.
      if (status !== 200 && status !== 409) {
        throw new TransportError(`handshake rejected with HTTP ${status}`, { status });
      }
      try {
        return decodeHandshakeResponse(parseJson(body, "/bridge/handshake"));
      } catch (error) {
        if (error instanceof ProtocolDecodeError) {
          throw new TransportError(error.message, { status, cause: error });
        }
        throw error;
      }
    },

    async poll(): Promise<PollResponse> {
      const timeoutSeconds = Math.ceil(pollTimeoutMs / 1000) + POLL_TIMEOUT_MARGIN_SECONDS;
      const { status, body } = await send(HttpRequestMethod.Get, "/bridge/poll", timeoutSeconds);
      if (status !== 200) {
        throw new TransportError(`poll failed with HTTP ${status}`, { status });
      }
      try {
        return decodePollResponse(parseJson(body, "/bridge/poll"));
      } catch (error) {
        if (error instanceof ProtocolDecodeError) {
          throw new TransportError(error.message, { status, cause: error });
        }
        throw error;
      }
    },

    async reportResult(result: CommandResult): Promise<void> {
      const { status } = await send(
        HttpRequestMethod.Post,
        "/bridge/result",
        SHORT_TIMEOUT_SECONDS,
        result,
      );
      if (status < 200 || status >= 300) {
        throw new TransportError(`result rejected with HTTP ${status}`, { status });
      }
    },

    async reportEvents(report: EventReport): Promise<void> {
      const { status } = await send(
        HttpRequestMethod.Post,
        "/bridge/event",
        SHORT_TIMEOUT_SECONDS,
        report,
      );
      if (status < 200 || status >= 300) {
        throw new TransportError(`event report rejected with HTTP ${status}`, { status });
      }
    },
  };
}
