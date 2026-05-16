/**
 * Conversions between live Script API objects and the flat, JSON-clonable
 * shapes the bridge protocol carries.
 *
 * Two directions: `*Summary` projects a Script API object into wire JSON for a
 * result; `build*` constructs a Script API object from a validated payload.
 */
import {
  BlockPermutation,
  ItemLockMode,
  ItemStack,
  type Block,
  type Container,
  type Entity,
  type Vector3,
} from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import { isPlayer } from "./world-lookup";
import type { PayloadReader } from "../payload";

/** Block state values are restricted to these primitive types. */
type BlockStateValue = boolean | number | string;

/** Projects a {@link Vector3} to a plain object. */
export function vec(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

/** Projects an {@link Entity} (or {@link Player}) into wire JSON. */
export function entitySummary(entity: Entity): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: entity.id,
    type_id: entity.typeId,
    location: vec(entity.location),
    dimension: entity.dimension.id,
    rotation: entity.getRotation(),
    tags: entity.getTags(),
    name_tag: entity.nameTag,
  };
  if (isPlayer(entity)) {
    summary["name"] = entity.name;
  }
  return summary;
}

/** Projects a {@link Block} into wire JSON. */
export function blockSummary(block: Block): Record<string, unknown> {
  return {
    type_id: block.typeId,
    states: block.permutation.getAllStates(),
    location: vec(block.location),
    is_air: block.isAir,
    is_liquid: block.isLiquid,
  };
}

const LOCK_MODE_TO_WIRE: Readonly<Record<ItemLockMode, string>> = {
  [ItemLockMode.none]: "none",
  [ItemLockMode.slot]: "lock_in_slot",
  [ItemLockMode.inventory]: "lock_in_inventory",
};

const WIRE_TO_LOCK_MODE: Readonly<Record<string, ItemLockMode>> = {
  none: ItemLockMode.none,
  lock_in_slot: ItemLockMode.slot,
  lock_in_inventory: ItemLockMode.inventory,
};

/** Projects an {@link ItemStack} into wire JSON. */
export function itemStackSummary(item: ItemStack): Record<string, unknown> {
  return {
    type_id: item.typeId,
    amount: item.amount,
    name_tag: item.nameTag ?? null,
    lore: item.getLore(),
    keep_on_death: item.keepOnDeath,
    lock_mode: LOCK_MODE_TO_WIRE[item.lockMode] ?? "none",
  };
}

/** Projects a {@link Container} into wire JSON — its size and occupied slots. */
export function containerSummary(container: Container): Record<string, unknown> {
  const slots: Record<string, unknown>[] = [];
  for (let slot = 0; slot < container.size; slot += 1) {
    const item = container.getItem(slot);
    if (item !== undefined) {
      slots.push({ slot, ...itemStackSummary(item) });
    }
  }
  return { size: container.size, empty_slots: container.emptySlotsCount, items: slots };
}

function coerceBlockStates(states: Record<string, unknown>): Record<string, BlockStateValue> {
  const coerced: Record<string, BlockStateValue> = {};
  for (const [name, value] of Object.entries(states)) {
    if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
      throw CommandError.invalidInput(`block state '${name}' must be a boolean, number, or string`);
    }
    coerced[name] = value;
  }
  return coerced;
}

/** Builds a {@link BlockPermutation} from a block type and optional states. */
export function buildBlockPermutation(
  blockType: string,
  states: Record<string, unknown> | undefined,
): BlockPermutation {
  try {
    return BlockPermutation.resolve(
      blockType,
      states === undefined ? undefined : coerceBlockStates(states),
    );
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw CommandError.invalidInput(
      `cannot resolve block '${blockType}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Builds an {@link ItemStack} from a type, count, and an optional `properties`
 * reader (`name_tag`, `lore`, `keep_on_death`, `lock_mode`).
 */
export function buildItemStack(
  itemType: string,
  count: number | undefined,
  properties: PayloadReader | undefined,
): ItemStack {
  let stack: ItemStack;
  try {
    stack = new ItemStack(itemType, count ?? 1);
  } catch (error) {
    throw CommandError.invalidInput(
      `cannot create item '${itemType}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (properties === undefined) return stack;

  const nameTag = properties.optionalString("name_tag");
  if (nameTag !== undefined) stack.nameTag = nameTag;

  const lore = properties.optionalStringArray("lore");
  if (lore !== undefined) stack.setLore(lore);

  const keepOnDeath = properties.optionalBoolean("keep_on_death");
  if (keepOnDeath !== undefined) stack.keepOnDeath = keepOnDeath;

  const lockMode = properties.optionalEnum("lock_mode", [
    "none",
    "lock_in_slot",
    "lock_in_inventory",
  ]);
  if (lockMode !== undefined) {
    const mode = WIRE_TO_LOCK_MODE[lockMode];
    if (mode !== undefined) stack.lockMode = mode;
  }
  return stack;
}
