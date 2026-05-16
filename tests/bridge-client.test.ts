import { describe, expect, it, vi } from "vitest";
import { createBridgeClient } from "../src/bridge-client";
import type { CommandPump } from "../src/command-pump";
import type { Command, HandshakeRequest, HandshakeResponse, PollResponse } from "../src/protocol";
import type { BridgeTransport } from "../src/transport/http-transport";
import { TransportError } from "../src/transport/transport-error";
import { createFakeScheduler, createRecordingLogger } from "./support/fakes";

const HANDSHAKE_REQUEST: HandshakeRequest = {
  protocol_version: "1.0.0",
  behavior_pack_version: "0.1.0",
  script_modules: [],
  world_id: "world_test",
};

function command(): Command {
  return {
    id: "cmd_01HX0000000000000000000000",
    kind: "mc_world_get_info",
    payload: {},
    issued_at: "2026-05-15T12:00:00.000Z",
    deadline_ms: 15000,
  };
}

function scriptedTransport(
  handshakes: HandshakeResponse[],
  polls: (PollResponse | TransportError)[],
): BridgeTransport {
  let handshakeCall = 0;
  let pollCall = 0;
  return {
    handshake: () => {
      const response = handshakes[Math.min(handshakeCall, handshakes.length - 1)];
      handshakeCall += 1;
      return Promise.resolve(response!);
    },
    poll: () => {
      const next = polls[pollCall];
      pollCall += 1;
      if (next === undefined) return Promise.reject(new TransportError("poll script exhausted"));
      if (next instanceof TransportError) return Promise.reject(next);
      return Promise.resolve(next);
    },
    reportResult: () => Promise.resolve(),
    reportEvents: () => Promise.resolve(),
    setPollTimeoutMs: () => {},
  };
}

function fakePump(): CommandPump & { submitted: Command[] } {
  const submitted: Command[] = [];
  return { submitted, submit: (c) => submitted.push(c), start: () => {} };
}

const acceptance: HandshakeResponse = {
  accepted: true,
  server_version: "0.1.0",
  protocol_version: "1.0.0",
  poll_timeout_ms: 30000,
  resync_subscriptions: [],
};
const refusal: HandshakeResponse = {
  accepted: false,
  reason: "incompatible bridge protocol version '2.0.0'",
  server_protocol_version: "2.0.0",
};

describe("createBridgeClient", () => {
  it("stops without polling when the handshake is refused", async () => {
    const onHandshakeAccepted = vi.fn();
    const pump = fakePump();
    const client = createBridgeClient({
      transport: scriptedTransport([refusal], []),
      commandPump: pump,
      scheduler: createFakeScheduler(),
      logger: createRecordingLogger(),
      handshakeRequest: HANDSHAKE_REQUEST,
      onHandshakeAccepted,
    });

    await client.run();

    expect(onHandshakeAccepted).not.toHaveBeenCalled();
    expect(pump.submitted).toHaveLength(0);
  });

  it("polls after acceptance, submits commands, and re-handshakes on a 409", async () => {
    const onHandshakeAccepted = vi.fn();
    const pump = fakePump();
    const transport = scriptedTransport(
      [acceptance, refusal],
      [
        { commands: [command()], server_time: "2026-05-15T12:00:00.000Z" },
        new TransportError("session lost", { status: 409 }),
      ],
    );
    const client = createBridgeClient({
      transport,
      commandPump: pump,
      scheduler: createFakeScheduler(),
      logger: createRecordingLogger(),
      handshakeRequest: HANDSHAKE_REQUEST,
      onHandshakeAccepted,
    });

    await client.run();

    expect(onHandshakeAccepted).toHaveBeenCalledTimes(1);
    expect(pump.submitted).toHaveLength(1);
    expect(pump.submitted[0]?.kind).toBe("mc_world_get_info");
  });
});
