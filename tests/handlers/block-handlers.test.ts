import { describe, expect, it } from "vitest";
import type { HandlerContext } from "../../src/dispatcher/command-handler";
import { blockHandlers } from "../../src/dispatcher/handlers/block-handlers";
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

const OVERWORLD = "overworld";

describe("block handlers", () => {
  it("sets a block and reads it back", async () => {
    const ctx = contextWith(new FakeWorld());
    await blockHandlers["mc_block_set"]!(
      { dimension: OVERWORLD, location: { x: 0, y: 64, z: 0 }, block_type: "minecraft:stone" },
      ctx,
    );
    const block = (await blockHandlers["mc_block_get"]!(
      { dimension: OVERWORLD, location: { x: 0, y: 64, z: 0 } },
      ctx,
    )) as { type_id: string };
    expect(block.type_id).toBe("minecraft:stone");
  });

  it("fills a volume in replace mode and counts the changed blocks", async () => {
    const ctx = contextWith(new FakeWorld());
    const result = (await blockHandlers["mc_block_fill"]!(
      {
        dimension: OVERWORLD,
        from: { x: 0, y: 64, z: 0 },
        to: { x: 1, y: 64, z: 1 },
        block_type: "minecraft:glass",
      },
      ctx,
    )) as { blocks_changed: number; volume: number };
    expect(result.volume).toBe(4);
    expect(result.blocks_changed).toBe(4);
  });

  it("fills only the perimeter in outline mode", async () => {
    const ctx = contextWith(new FakeWorld());
    const result = (await blockHandlers["mc_block_fill"]!(
      {
        dimension: OVERWORLD,
        from: { x: 0, y: 64, z: 0 },
        to: { x: 2, y: 66, z: 2 },
        block_type: "minecraft:glass",
        options: { mode: "outline" },
      },
      ctx,
    )) as { blocks_changed: number };
    // A 3x3x3 box: all 27 cells are on the perimeter except the centre one.
    expect(result.blocks_changed).toBe(26);
  });

  it("paginates a volume scan with a cursor", async () => {
    const ctx = contextWith(new FakeWorld());
    const args = {
      dimension: OVERWORLD,
      from: { x: 0, y: 64, z: 0 },
      to: { x: 1, y: 64, z: 1 },
    };
    const page = (await blockHandlers["mc_block_get_volume"]!(args, ctx)) as {
      blocks: unknown[];
      cursor: string | null;
      volume: number;
    };
    expect(page.volume).toBe(4);
    expect(page.blocks).toHaveLength(4);
    expect(page.cursor).toBeNull();
  });

  it("detects a matching block in a volume", async () => {
    const ctx = contextWith(new FakeWorld());
    await blockHandlers["mc_block_set"]!(
      {
        dimension: OVERWORLD,
        location: { x: 3, y: 64, z: 3 },
        block_type: "minecraft:diamond_ore",
      },
      ctx,
    );
    const result = (await blockHandlers["mc_block_contains"]!(
      {
        dimension: OVERWORLD,
        from: { x: 0, y: 64, z: 0 },
        to: { x: 5, y: 64, z: 5 },
        filter: { include: ["minecraft:diamond_ore"] },
      },
      ctx,
    )) as { contains: boolean };
    expect(result.contains).toBe(true);
  });
});
