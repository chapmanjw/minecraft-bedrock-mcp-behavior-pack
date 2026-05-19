import { describe, expect, it } from "vitest";
import type { HandlerContext } from "../../src/dispatcher/command-handler";
import { serverHandlers } from "../../src/dispatcher/handlers/server-handlers";
import { createFakeScheduler, createRecordingLogger, flushMicrotasks } from "../support/fakes";

/** A fake player that records the commands run on it. */
interface FakePlayer {
  readonly commands: string[];
  runCommand(command: string): void;
}

function fakePlayer(): FakePlayer {
  const commands: string[] = [];
  return {
    commands,
    runCommand(command) {
      commands.push(command);
    },
  };
}

/** A handler context whose world reports the given players as online. */
function contextWith(players: FakePlayer[]): HandlerContext {
  return {
    world: { getAllPlayers: () => players },
    scheduler: createFakeScheduler(),
    subscriptions: {},
    events: {},
    capabilities: {},
    logger: createRecordingLogger(),
    deadlineMs: 15_000,
  } as unknown as HandlerContext;
}

describe("server handlers — mc_server_reload_world", () => {
  it("reports the reload as scheduled and then runs /reload all", async () => {
    const player = fakePlayer();
    const result = (await serverHandlers["mc_server_reload_world"]!({}, contextWith([player]))) as {
      reload_scheduled: boolean;
      online_players: number;
    };

    expect(result).toEqual({ reload_scheduled: true, online_players: 1 });
    // The command result is returned first; /reload all fires after the delay.
    await flushMicrotasks();
    expect(player.commands).toEqual(["reload all"]);
  });

  it("fails the command when no player is online", async () => {
    await expect(
      serverHandlers["mc_server_reload_world"]!({}, contextWith([])),
    ).rejects.toMatchObject({
      code: "BEHAVIOR_PACK_ERROR",
      details: { reason: "no_player_online" },
    });
  });
});
