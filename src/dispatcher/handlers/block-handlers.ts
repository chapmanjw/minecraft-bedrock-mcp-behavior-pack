/**
 * Block handlers — single-block reads and writes, plus bounded-volume
 * operations.
 *
 * Volume operations (`get_volume`, `fill`, `clone`, `replace`, `contains`) can
 * touch a large box, so they run as `system.runJob` generators that yield
 * every {@link YIELD_INTERVAL} blocks — the script watchdog never sees a long
 * synchronous loop. `get_volume` is additionally paginated: it returns a
 * `cursor` the caller passes back to resume the scan.
 */
import type { BlockPermutation, Dimension, Vector3 } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { blockSummary, buildBlockPermutation } from "./conversions";
import { resolveDimension } from "./world-lookup";

/** Matching blocks returned per `get_volume` page. */
const PAGE_SIZE = 1024;
/** Blocks scanned per `get_volume` page before yielding a partial cursor. */
const MAX_SCAN_PER_PAGE = 16_384;
/** Blocks processed between generator yields. */
const YIELD_INTERVAL = 2_048;

interface BlockFilter {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

interface Box {
  readonly min: Vector3;
  readonly max: Vector3;
}

function readBox(reader: PayloadReader): Box {
  const from = reader.vector3("from");
  const to = reader.vector3("to");
  return {
    min: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
    max: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) },
  };
}

function boxVolume(box: Box): number {
  return (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1);
}

function readFilter(reader: PayloadReader | undefined): BlockFilter | undefined {
  if (reader === undefined) return undefined;
  return {
    include: reader.optionalStringArray("include"),
    exclude: reader.optionalStringArray("exclude"),
  };
}

function matchesFilter(typeId: string, filter: BlockFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.include !== undefined && !filter.include.includes(typeId)) return false;
  if (filter.exclude !== undefined && filter.exclude.includes(typeId)) return false;
  return true;
}

/** Reads a block, tolerating unloaded chunks by returning `undefined`. */
function getBlockSafe(dimension: Dimension, location: Vector3): ReturnType<Dimension["getBlock"]> {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

function isPerimeter(box: Box, x: number, y: number, z: number): boolean {
  return (
    x === box.min.x ||
    x === box.max.x ||
    y === box.min.y ||
    y === box.max.y ||
    z === box.min.z ||
    z === box.max.z
  );
}

// ---- single-block handlers --------------------------------------------------

const getBlock: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_get");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  return ctx.scheduler.run(() => {
    const block = getBlockSafe(resolveDimension(ctx.world, dimensionId), location);
    if (block === undefined)
      throw CommandError.notFound("no block at the location (unloaded chunk?)");
    return blockSummary(block);
  });
};

const getTop: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_get_top");
  const dimensionId = reader.string("dimension");
  const x = reader.integer("x");
  const z = reader.integer("z");
  return ctx.scheduler.run(() => {
    const block = resolveDimension(ctx.world, dimensionId).getTopmostBlock({ x, z });
    if (block === undefined) throw CommandError.notFound("no topmost block in the column");
    return blockSummary(block);
  });
};

const setBlock: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_set");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  const blockType = reader.string("block_type");
  const states = reader.optionalRecord("states");
  return ctx.scheduler.run(() => {
    const permutation = buildBlockPermutation(blockType, states);
    const block = getBlockSafe(resolveDimension(ctx.world, dimensionId), location);
    if (block === undefined)
      throw CommandError.notFound("no block at the location (unloaded chunk?)");
    block.setPermutation(permutation);
    return { location, block_type: blockType };
  });
};

// ---- volume handlers --------------------------------------------------------

const getVolume: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_get_volume");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const filter = readFilter(reader.optionalObject("filter"));
  const cursorRaw = reader.optionalString("cursor");
  const start = cursorRaw === undefined ? 0 : Number(cursorRaw);
  if (!Number.isInteger(start) || start < 0) {
    throw CommandError.invalidInput(`cursor '${cursorRaw}' is not a valid page cursor`);
  }
  const dimension = resolveDimension(ctx.world, dimensionId);
  const spanX = box.max.x - box.min.x + 1;
  const spanY = box.max.y - box.min.y + 1;
  const spanZ = box.max.z - box.min.z + 1;
  const total = spanX * spanY * spanZ;

  return ctx.scheduler.runJob(function* collect() {
    const blocks: Record<string, unknown>[] = [];
    let index = start;
    let scanned = 0;
    while (index < total && blocks.length < PAGE_SIZE && scanned < MAX_SCAN_PER_PAGE) {
      const location = {
        x: box.min.x + Math.floor(index / (spanY * spanZ)),
        y: box.min.y + (Math.floor(index / spanZ) % spanY),
        z: box.min.z + (index % spanZ),
      };
      const block = getBlockSafe(dimension, location);
      if (block !== undefined && matchesFilter(block.typeId, filter)) {
        blocks.push(blockSummary(block));
      }
      index += 1;
      scanned += 1;
      if (scanned % YIELD_INTERVAL === 0) yield;
    }
    return { blocks, cursor: index < total ? String(index) : null, volume: total };
  });
};

const containsBlock: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_contains");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const filter = readFilter(reader.object_("filter"));
  const dimension = resolveDimension(ctx.world, dimensionId);

  return ctx.scheduler.runJob(function* scan() {
    let processed = 0;
    for (let x = box.min.x; x <= box.max.x; x += 1) {
      for (let y = box.min.y; y <= box.max.y; y += 1) {
        for (let z = box.min.z; z <= box.max.z; z += 1) {
          const block = getBlockSafe(dimension, { x, y, z });
          if (block !== undefined && matchesFilter(block.typeId, filter)) {
            return { contains: true, match: blockSummary(block) };
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { contains: false, match: null };
  });
};

const fillBlocks: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_fill");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const blockType = reader.string("block_type");
  const states = reader.optionalRecord("states");
  const options = reader.optionalObject("options");
  const mode = options?.optionalEnum("mode", ["replace", "keep", "hollow", "outline"]) ?? "replace";
  const filter = readFilter(options?.optionalObject("filter"));
  const dimension = resolveDimension(ctx.world, dimensionId);
  const fillPermutation = buildBlockPermutation(blockType, states);
  const airPermutation = buildBlockPermutation("minecraft:air", undefined);

  return ctx.scheduler.runJob(function* fill() {
    let changed = 0;
    let processed = 0;
    for (let x = box.min.x; x <= box.max.x; x += 1) {
      for (let y = box.min.y; y <= box.max.y; y += 1) {
        for (let z = box.min.z; z <= box.max.z; z += 1) {
          const perimeter = isPerimeter(box, x, y, z);
          let target: BlockPermutation | undefined;
          if (mode === "hollow") target = perimeter ? fillPermutation : airPermutation;
          else if (mode === "outline") target = perimeter ? fillPermutation : undefined;
          else target = fillPermutation;

          if (target !== undefined) {
            const block = getBlockSafe(dimension, { x, y, z });
            if (block !== undefined && matchesFilter(block.typeId, filter)) {
              if (mode !== "keep" || block.isAir) {
                block.setPermutation(target);
                changed += 1;
              }
            }
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { mode, blocks_changed: changed, volume: boxVolume(box) };
  });
};

const replaceBlocks: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_replace");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const sourceFilter = readFilter(reader.object_("source_filter"));
  const replacement = reader.object_("replacement");
  const blockType = replacement.string("block_type");
  const states = replacement.optionalRecord("states");
  const dimension = resolveDimension(ctx.world, dimensionId);
  const permutation = buildBlockPermutation(blockType, states);

  return ctx.scheduler.runJob(function* replace() {
    let changed = 0;
    let processed = 0;
    for (let x = box.min.x; x <= box.max.x; x += 1) {
      for (let y = box.min.y; y <= box.max.y; y += 1) {
        for (let z = box.min.z; z <= box.max.z; z += 1) {
          const block = getBlockSafe(dimension, { x, y, z });
          if (block !== undefined && matchesFilter(block.typeId, sourceFilter)) {
            block.setPermutation(permutation);
            changed += 1;
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { block_type: blockType, blocks_changed: changed, volume: boxVolume(box) };
  });
};

const cloneBlocks: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_clone");
  const sourceDimensionId = reader.string("source_dimension");
  const sourceBox: Box = (() => {
    const from = reader.vector3("source_from");
    const to = reader.vector3("source_to");
    return {
      min: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
      max: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) },
    };
  })();
  const destinationDimensionId = reader.string("destination_dimension");
  const destination = reader.vector3("destination_location");
  const options = reader.optionalObject("options");
  const mode = options?.optionalEnum("mode", ["replace", "masked"]) ?? "replace";
  const sourceDimension = resolveDimension(ctx.world, sourceDimensionId);
  const destinationDimension = resolveDimension(ctx.world, destinationDimensionId);

  return ctx.scheduler.runJob(function* clone() {
    let copied = 0;
    let processed = 0;
    for (let x = sourceBox.min.x; x <= sourceBox.max.x; x += 1) {
      for (let y = sourceBox.min.y; y <= sourceBox.max.y; y += 1) {
        for (let z = sourceBox.min.z; z <= sourceBox.max.z; z += 1) {
          const source = getBlockSafe(sourceDimension, { x, y, z });
          if (source !== undefined && (mode !== "masked" || !source.isAir)) {
            const target = getBlockSafe(destinationDimension, {
              x: destination.x + (x - sourceBox.min.x),
              y: destination.y + (y - sourceBox.min.y),
              z: destination.z + (z - sourceBox.min.z),
            });
            if (target !== undefined) {
              target.setPermutation(source.permutation);
              copied += 1;
            }
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    // Block-level clone moves blocks only; entity cloning is out of scope.
    return { mode, blocks_copied: copied, entities_cloned: false };
  });
};

/** The block-domain handler table. */
export const blockHandlers: HandlerMap = {
  mc_block_get: getBlock,
  mc_block_get_volume: getVolume,
  mc_block_get_top: getTop,
  mc_block_contains: containsBlock,
  mc_block_set: setBlock,
  mc_block_fill: fillBlocks,
  mc_block_clone: cloneBlocks,
  mc_block_replace: replaceBlocks,
};
