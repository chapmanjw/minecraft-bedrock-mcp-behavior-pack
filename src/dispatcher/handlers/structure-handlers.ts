/**
 * Structure handlers — `world.structureManager` operations.
 *
 * Covers `mc_structure_*`: listing, metadata, creation (empty, captured from
 * the world, or built from a run-length-encoded block grid), placement,
 * deletion, and in-memory block edits.
 */
import {
  StructureAnimationMode,
  StructureMirrorAxis,
  StructureRotation,
  StructureSaveMode,
} from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { buildBlockPermutation, vec } from "./conversions";
import { resolveDimension } from "./world-lookup";

const SAVE_MODES = ["memory", "world"] as const;
const ROTATIONS = ["None", "Rotate90", "Rotate180", "Rotate270"] as const;
const MIRRORS = ["None", "X", "Z", "XZ"] as const;
const ANIMATIONS = ["None", "Layers", "Blocks"] as const;

const SAVE_MODE: Readonly<Record<string, StructureSaveMode>> = {
  memory: StructureSaveMode.Memory,
  world: StructureSaveMode.World,
};
const ROTATION: Readonly<Record<string, StructureRotation>> = {
  None: StructureRotation.None,
  Rotate90: StructureRotation.Rotate90,
  Rotate180: StructureRotation.Rotate180,
  Rotate270: StructureRotation.Rotate270,
};
const MIRROR: Readonly<Record<string, StructureMirrorAxis>> = {
  None: StructureMirrorAxis.None,
  X: StructureMirrorAxis.X,
  Z: StructureMirrorAxis.Z,
  XZ: StructureMirrorAxis.XZ,
};
const ANIMATION: Readonly<Record<string, StructureAnimationMode>> = {
  None: StructureAnimationMode.None,
  Layers: StructureAnimationMode.Layers,
  Blocks: StructureAnimationMode.Blocks,
};

function optionalSaveMode(reader: PayloadReader | undefined): StructureSaveMode | undefined {
  const value = reader?.optionalEnum("save_mode", SAVE_MODES);
  return value === undefined ? undefined : SAVE_MODE[value];
}

const listStructures: CommandHandler = (_payload, ctx) => {
  ctx.capabilities.requireFeature("structure.list");
  return ctx.scheduler.run(() => ({ ids: ctx.world.structureManager.getWorldStructureIds() }));
};

const getStructure: CommandHandler = (payload, ctx) => {
  const id = PayloadReader.open(payload, "mc_structure_get").string("id");
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.get(id);
    if (structure === undefined) throw CommandError.notFound(`no structure '${id}'`);
    return { id: structure.id, size: vec(structure.size) };
  });
};

const createEmpty: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_create_empty");
  const id = reader.string("id");
  const size = reader.vector3("size");
  const saveMode = reader.optionalEnum("save_mode", SAVE_MODES);
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.createEmpty(
      id,
      size,
      saveMode === undefined ? undefined : SAVE_MODE[saveMode],
    );
    return { id: structure.id, size: vec(structure.size) };
  });
};

const createFromWorld: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_create_from_world");
  const id = reader.string("id");
  const dimensionId = reader.string("dimension");
  const from = reader.vector3("from");
  const to = reader.vector3("to");
  const options = reader.optionalObject("options");
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.createFromWorld(
      id,
      resolveDimension(ctx.world, dimensionId),
      from,
      to,
      {
        saveMode: optionalSaveMode(options),
        includeBlocks: options?.optionalBoolean("include_blocks"),
        includeEntities: options?.optionalBoolean("include_entities"),
      },
    );
    return { id: structure.id, size: vec(structure.size) };
  });
};

const placeStructure: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_place");
  const id = reader.string("id");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  const options = reader.optionalObject("options");
  const rotation = options?.optionalEnum("rotation", ROTATIONS);
  const mirror = options?.optionalEnum("mirror", MIRRORS);
  const animation = options?.optionalEnum("animation_mode", ANIMATIONS);
  const integrity = options?.optionalNumber("integrity");
  const includeEntities = options?.optionalBoolean("include_entities");
  const animationSeconds = options?.optionalNumber("animation_seconds");
  return ctx.scheduler.run(() => {
    ctx.world.structureManager.place(id, resolveDimension(ctx.world, dimensionId), location, {
      rotation: rotation === undefined ? undefined : ROTATION[rotation],
      mirror: mirror === undefined ? undefined : MIRROR[mirror],
      animationMode: animation === undefined ? undefined : ANIMATION[animation],
      integrity,
      includeEntities,
      animationSeconds,
    });
    return { id, location: vec(location) };
  });
};

const deleteStructure: CommandHandler = (payload, ctx) => {
  const id = PayloadReader.open(payload, "mc_structure_delete").string("id");
  return ctx.scheduler.run(() => ({ id, deleted: ctx.world.structureManager.delete(id) }));
};

/** Cells processed per `runJob` yield while building a structure. */
const STRUCTURE_YIELD_INTERVAL = 2048;

interface PaletteEntry {
  readonly name: string;
  readonly states?: Record<string, unknown>;
}

interface BlockRun {
  readonly count: number;
  readonly index: number;
}

/** Reads and narrows the non-empty `palette` array of a create-from-blocks payload. */
function readPalette(reader: PayloadReader): PaletteEntry[] {
  const raw = reader.raw("palette");
  if (!Array.isArray(raw) || raw.length === 0) {
    throw CommandError.invalidInput("palette must be a non-empty array");
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw CommandError.invalidInput(`palette[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const name = record["name"];
    if (typeof name !== "string" || name.length === 0) {
      throw CommandError.invalidInput(`palette[${index}].name must be a non-empty string`);
    }
    const states = record["states"];
    if (states !== undefined && (typeof states !== "object" || states === null)) {
      throw CommandError.invalidInput(`palette[${index}].states must be an object`);
    }
    return { name, states: states as Record<string, unknown> | undefined };
  });
}

/** Reads the run-length-encoded `[count, index]` block layer at `key`. */
function readRuns(reader: PayloadReader, key: string): BlockRun[] {
  const raw = reader.raw(key);
  if (!Array.isArray(raw)) {
    throw CommandError.invalidInput(`${key} must be an array of [count, index] runs`);
  }
  return raw.map((run, position) => {
    if (
      !Array.isArray(run) ||
      run.length !== 2 ||
      !Number.isInteger(run[0]) ||
      !Number.isInteger(run[1])
    ) {
      throw CommandError.invalidInput(`${key}[${position}] must be a [count, index] integer pair`);
    }
    return { count: run[0] as number, index: run[1] as number };
  });
}

/** The cell count of a structure, requiring positive integer extents. */
function structureVolume(size: Vector3): number {
  for (const axis of ["x", "y", "z"] as const) {
    const extent = size[axis];
    if (!Number.isInteger(extent) || extent <= 0) {
      throw CommandError.invalidInput(`size.${axis} must be a positive integer`);
    }
  }
  return size.x * size.y * size.z;
}

/** Expands `[count, index]` runs into a flat per-cell palette-index array. */
function expandRuns(runs: BlockRun[], volume: number, paletteSize: number): number[] {
  const cells: number[] = [];
  for (const { count, index } of runs) {
    if (count < 1) {
      throw CommandError.invalidInput("a block run count must be at least 1");
    }
    if (index < -1 || index >= paletteSize) {
      throw CommandError.invalidInput(
        `block run index ${index} is outside the range -1..${paletteSize - 1}`,
      );
    }
    if (cells.length + count > volume) {
      throw CommandError.invalidInput(`block runs exceed the ${volume}-cell volume`);
    }
    for (let n = 0; n < count; n += 1) cells.push(index);
  }
  if (cells.length !== volume) {
    throw CommandError.invalidInput(`block runs cover ${cells.length} cells, expected ${volume}`);
  }
  return cells;
}

const createFromBlocks: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_create_from_blocks");
  const id = reader.string("id");
  const size = reader.vector3("size");
  const palette = readPalette(reader);
  const runs = readRuns(reader, "blocks");
  const saveMode = reader.optionalEnum("save_mode", SAVE_MODES);
  const volume = structureVolume(size);
  const cells = expandRuns(runs, volume, palette.length);
  return ctx.scheduler.runJob(function* build() {
    // Resolve every palette permutation up front, so an unknown block fails the
    // command before a partial structure is created.
    const permutations = palette.map((entry) => buildBlockPermutation(entry.name, entry.states));
    const structure = ctx.world.structureManager.createEmpty(
      id,
      size,
      saveMode === undefined ? StructureSaveMode.World : SAVE_MODE[saveMode],
    );
    let placed = 0;
    let processed = 0;
    for (let x = 0; x < size.x; x += 1) {
      for (let y = 0; y < size.y; y += 1) {
        for (let z = 0; z < size.z; z += 1) {
          const cell = cells[size.z * size.y * x + size.z * y + z];
          if (cell !== undefined && cell >= 0) {
            const permutation = permutations[cell];
            if (permutation !== undefined) {
              structure.setBlockPermutation({ x, y, z }, permutation);
              placed += 1;
            }
          }
          processed += 1;
          if (processed % STRUCTURE_YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { id: structure.id, size: vec(structure.size), blocks_placed: placed };
  });
};

const setStructureBlock: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_set_block");
  const id = reader.string("id");
  const location = reader.vector3("location");
  const blockType = reader.string("block_type");
  const states = reader.optionalRecord("states");
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.get(id);
    if (structure === undefined) throw CommandError.notFound(`no structure '${id}'`);
    structure.setBlockPermutation(location, buildBlockPermutation(blockType, states));
    return { id, location: vec(location), block_type: blockType };
  });
};

/** The structure-domain handler table. */
export const structureHandlers: HandlerMap = {
  mc_structure_list: listStructures,
  mc_structure_get: getStructure,
  mc_structure_create_empty: createEmpty,
  mc_structure_create_from_world: createFromWorld,
  mc_structure_create_from_blocks: createFromBlocks,
  mc_structure_place: placeStructure,
  mc_structure_delete: deleteStructure,
  mc_structure_set_block: setStructureBlock,
};
