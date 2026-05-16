/**
 * Structure handlers — `world.structureManager` operations.
 *
 * Covers `mc_structure_*`: listing, metadata, creation (empty or captured from
 * the world), placement, deletion, and in-memory block edits.
 */
import {
  StructureAnimationMode,
  StructureMirrorAxis,
  StructureRotation,
  StructureSaveMode,
} from "@minecraft/server";
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
  mc_structure_place: placeStructure,
  mc_structure_delete: deleteStructure,
  mc_structure_set_block: setStructureBlock,
};
