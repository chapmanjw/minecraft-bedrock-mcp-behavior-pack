import { describe, expect, it } from "vitest";
import type { CommandHandler, HandlerServices } from "../../src/dispatcher/command-handler";
import { createDispatcher } from "../../src/dispatcher/dispatcher";
import { CommandError } from "../../src/errors/command-error";
import type { Command } from "../../src/protocol";
import { createFakeScheduler, createRecordingLogger } from "../support/fakes";

const COMMAND_ID = "cmd_01HX0000000000000000000000";

function fakeServices(): HandlerServices {
  return {
    world: {},
    scheduler: createFakeScheduler(),
    subscriptions: {},
    events: {},
    capabilities: {},
    logger: createRecordingLogger(),
  } as unknown as HandlerServices;
}

function command(kind: string): Command {
  return {
    id: COMMAND_ID,
    kind,
    payload: {},
    issued_at: "2026-05-15T12:00:00.000Z",
    deadline_ms: 15000,
  };
}

function dispatcherWith(kind: string, handler: CommandHandler) {
  return createDispatcher({ [kind]: handler }, fakeServices());
}

describe("createDispatcher", () => {
  it("returns an ok envelope with the handler's value", async () => {
    const dispatcher = dispatcherWith("mc_test", () => Promise.resolve({ answer: 42 }));
    const result = await dispatcher.dispatch(command("mc_test"));
    expect(result).toEqual({ id: COMMAND_ID, status: "ok", result: { answer: 42 } });
  });

  it("substitutes an empty object when a handler returns undefined", async () => {
    const dispatcher = dispatcherWith("mc_test", () => Promise.resolve(undefined));
    const result = await dispatcher.dispatch(command("mc_test"));
    expect(result).toEqual({ id: COMMAND_ID, status: "ok", result: {} });
  });

  it("maps a CommandError to its declared code", async () => {
    const dispatcher = dispatcherWith("mc_test", () =>
      Promise.reject(CommandError.notFound("missing entity")),
    );
    const result = await dispatcher.dispatch(command("mc_test"));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).toBe("missing entity");
    }
  });

  it("maps a typed Script API error name to a code", async () => {
    const dispatcher = dispatcherWith("mc_test", () => {
      const error = new Error("bad query");
      error.name = "EntityQueryError";
      return Promise.reject(error);
    });
    const result = await dispatcher.dispatch(command("mc_test"));
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("maps an unrecognized error to BEHAVIOR_PACK_ERROR", async () => {
    const dispatcher = dispatcherWith("mc_test", () => Promise.reject(new Error("boom")));
    const result = await dispatcher.dispatch(command("mc_test"));
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("BEHAVIOR_PACK_ERROR");
  });

  it("reports an unknown kind as UNSUPPORTED_CAPABILITY", async () => {
    const dispatcher = dispatcherWith("mc_test", () => Promise.resolve({}));
    const result = await dispatcher.dispatch(command("mc_unimplemented"));
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("UNSUPPORTED_CAPABILITY");
  });
});
