import { describe, expect, it } from "vitest";
import {
  decodeCommand,
  decodeHandshakeResponse,
  decodePollResponse,
  ProtocolDecodeError,
} from "../../src/protocol/validation";

const COMMAND_ID = "cmd_01HX0000000000000000000000";
const SUBSCRIPTION_ID = "sub_01HX0000000000000000000000";

function validCommand(): unknown {
  return {
    id: COMMAND_ID,
    kind: "mc_block_set",
    payload: { dimension: "overworld" },
    issued_at: "2026-05-15T12:34:56.789Z",
    deadline_ms: 15000,
  };
}

describe("decodeCommand", () => {
  it("decodes a well-formed command", () => {
    const command = decodeCommand(validCommand());
    expect(command.id).toBe(COMMAND_ID);
    expect(command.kind).toBe("mc_block_set");
    expect(command.deadline_ms).toBe(15000);
  });

  it("rejects a malformed command id", () => {
    expect(() => decodeCommand({ ...(validCommand() as object), id: "cmd_short" })).toThrow(
      ProtocolDecodeError,
    );
  });

  it("rejects a non-positive deadline", () => {
    expect(() => decodeCommand({ ...(validCommand() as object), deadline_ms: 0 })).toThrow(
      ProtocolDecodeError,
    );
  });

  it("rejects a non-object", () => {
    expect(() => decodeCommand("nope")).toThrow(ProtocolDecodeError);
  });
});

describe("decodePollResponse", () => {
  it("decodes an empty long-poll timeout", () => {
    const response = decodePollResponse({ commands: [], server_time: "2026-05-15T12:00:00.000Z" });
    expect(response.commands).toEqual([]);
  });

  it("decodes a batch of commands", () => {
    const response = decodePollResponse({
      commands: [validCommand()],
      server_time: "2026-05-15T12:00:00.000Z",
    });
    expect(response.commands).toHaveLength(1);
  });

  it("rejects a missing commands array", () => {
    expect(() => decodePollResponse({ server_time: "2026-05-15T12:00:00.000Z" })).toThrow(
      ProtocolDecodeError,
    );
  });
});

describe("decodeHandshakeResponse", () => {
  it("decodes an acceptance with resync subscriptions", () => {
    const response = decodeHandshakeResponse({
      accepted: true,
      server_version: "0.1.0",
      protocol_version: "1.0.0",
      poll_timeout_ms: 30000,
      resync_subscriptions: [
        { subscription_id: SUBSCRIPTION_ID, event_type: "playerJoin", filter: {} },
      ],
    });
    expect(response.accepted).toBe(true);
    if (response.accepted) {
      expect(response.poll_timeout_ms).toBe(30000);
      expect(response.resync_subscriptions).toHaveLength(1);
    }
  });

  it("decodes a refusal", () => {
    const response = decodeHandshakeResponse({
      accepted: false,
      reason: "incompatible",
      server_protocol_version: "2.0.0",
    });
    expect(response.accepted).toBe(false);
    if (!response.accepted) expect(response.reason).toBe("incompatible");
  });

  it("rejects a malformed resync subscription id", () => {
    expect(() =>
      decodeHandshakeResponse({
        accepted: true,
        server_version: "0.1.0",
        protocol_version: "1.0.0",
        poll_timeout_ms: 30000,
        resync_subscriptions: [{ subscription_id: "bad", event_type: "playerJoin" }],
      }),
    ).toThrow(ProtocolDecodeError);
  });
});
