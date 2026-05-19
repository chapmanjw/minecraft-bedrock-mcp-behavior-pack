import { describe, expect, it } from "vitest";
import type { HandlerContext } from "../../src/dispatcher/command-handler";
import { structureHandlers } from "../../src/dispatcher/handlers/structure-handlers";
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
    deadlineMs: 15_000,
  } as unknown as HandlerContext;
}

const createFromBlocks = structureHandlers["mc_structure_create_from_blocks"]!;

describe("mc_structure_create_from_blocks", () => {
  it("builds a world structure from RLE runs in ZYX order, skipping voids", async () => {
    const world = new FakeWorld();
    // A 2 x 1 x 3 grid (6 cells). Palette: 0 = stone, 1 = oak_planks.
    // Per-cell in ZYX order: [0, 1, -1, 1, 0, -1].
    const result = (await createFromBlocks(
      {
        id: "mcp:mural",
        size: { x: 2, y: 1, z: 3 },
        palette: [{ name: "minecraft:stone" }, { name: "minecraft:oak_planks" }],
        blocks: [
          [1, 0],
          [1, 1],
          [1, -1],
          [1, 1],
          [1, 0],
          [1, -1],
        ],
      },
      contextWith(world),
    )) as { id: string; blocks_placed: number };

    expect(result.id).toBe("mcp:mural");
    expect(result.blocks_placed).toBe(4);

    const structure = world.structureManager.get("mcp:mural");
    expect(structure).toBeDefined();
    // cell index for (x, y, z) is z + size.z * (y + size.y * x).
    expect(structure?.blockAt({ x: 0, y: 0, z: 0 })?.type.id).toBe("minecraft:stone");
    expect(structure?.blockAt({ x: 0, y: 0, z: 1 })?.type.id).toBe("minecraft:oak_planks");
    expect(structure?.blockAt({ x: 0, y: 0, z: 2 })).toBeUndefined(); // void
    expect(structure?.blockAt({ x: 1, y: 0, z: 0 })?.type.id).toBe("minecraft:oak_planks");
    expect(structure?.blockAt({ x: 1, y: 0, z: 1 })?.type.id).toBe("minecraft:stone");
    expect(structure?.blockCount).toBe(4);
  });

  it("collapses a solid region into a single run", async () => {
    const world = new FakeWorld();
    const result = (await createFromBlocks(
      {
        id: "mcp:slab",
        size: { x: 4, y: 1, z: 4 },
        palette: [{ name: "minecraft:stone" }],
        blocks: [[16, 0]],
      },
      contextWith(world),
    )) as { blocks_placed: number };

    expect(result.blocks_placed).toBe(16);
    expect(world.structureManager.get("mcp:slab")?.blockCount).toBe(16);
  });

  it("rejects runs whose counts do not sum to the volume", () => {
    expect(() =>
      createFromBlocks(
        {
          id: "mcp:bad",
          size: { x: 2, y: 1, z: 2 },
          palette: [{ name: "minecraft:stone" }],
          blocks: [[3, 0]],
        },
        contextWith(new FakeWorld()),
      ),
    ).toThrowError(/cover 3 cells, expected 4/);
  });

  it("rejects a palette index outside the palette", () => {
    expect(() =>
      createFromBlocks(
        {
          id: "mcp:bad",
          size: { x: 1, y: 1, z: 1 },
          palette: [{ name: "minecraft:stone" }],
          blocks: [[1, 2]],
        },
        contextWith(new FakeWorld()),
      ),
    ).toThrowError(/outside the range -1\.\.0/);
  });
});
