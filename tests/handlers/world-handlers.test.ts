import { describe, expect, it } from "vitest";
import type { HandlerContext } from "../../src/dispatcher/command-handler";
import { worldHandlers } from "../../src/dispatcher/handlers/world-handlers";
import { createFakeScheduler, createRecordingLogger } from "../support/fakes";
import { FakeWorld } from "../support/fake-world";

function contextWith(world: FakeWorld): HandlerContext {
  return {
    world,
    scheduler: createFakeScheduler(),
    subscriptions: {},
    events: {},
    capabilities: {},
    logger: createRecordingLogger(),
    deadlineMs: 15000,
  } as unknown as HandlerContext;
}

describe("world handlers", () => {
  it("sets and reads the time of day", async () => {
    const world = new FakeWorld();
    const ctx = contextWith(world);

    await worldHandlers["mc_world_set_time"]!({ value: 6000 }, ctx);
    expect(world.getTimeOfDay()).toBe(6000);

    const time = (await worldHandlers["mc_world_get_time"]!({}, ctx)) as { time_of_day: number };
    expect(time.time_of_day).toBe(6000);
  });

  it("lists the three dimensions", async () => {
    const result = (await worldHandlers["mc_world_get_dimensions"]!(
      {},
      contextWith(new FakeWorld()),
    )) as {
      dimensions: string[];
    };
    expect(result.dimensions).toEqual(["overworld", "nether", "the_end"]);
  });

  it("broadcasts a chat message to everyone", async () => {
    const world = new FakeWorld();
    await worldHandlers["mc_world_send_message"]!(
      { target: "all", message: "hello world" },
      contextWith(world),
    );
    expect(world.messages).toContain("hello world");
  });

  it("rejects a payload that is not an object", () => {
    // Payload validation runs before any async work, so the handler rejects the
    // bad payload synchronously — the dispatcher's try/catch still settles it.
    expect(() => worldHandlers["mc_world_set_time"]!(42, contextWith(new FakeWorld()))).toThrow();
  });

  it("reports world info with the live player count and tick", async () => {
    const info = (await worldHandlers["mc_world_get_info"]!({}, contextWith(new FakeWorld()))) as {
      player_count: number;
      dimensions: string[];
    };
    expect(info.player_count).toBe(0);
    expect(info.dimensions).toHaveLength(3);
  });
});
