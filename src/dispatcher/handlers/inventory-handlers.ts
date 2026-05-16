/**
 * Inventory handlers — dropped items and container slot access.
 *
 * Covers `mc_item_spawn` and `mc_inventory_*`. A container is referenced either
 * by an entity id or by a block location; {@link requireContainer} resolves
 * both.
 */
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { buildItemStack, containerSummary, entitySummary, itemStackSummary } from "./conversions";
import { requireContainer, resolveDimension } from "./world-lookup";

/** Reads a `{ entity_id? , block? }` container reference. */
function readContainerRef(reader: PayloadReader): {
  entityId?: string;
  block?: { dimension: string; location: { x: number; y: number; z: number } };
} {
  const entityId = reader.optionalString("entity_id");
  const blockReader = reader.optionalObject("block");
  if (entityId !== undefined) return { entityId };
  if (blockReader !== undefined) {
    return {
      block: {
        dimension: blockReader.string("dimension"),
        location: blockReader.vector3("location"),
      },
    };
  }
  throw CommandError.invalidInput("container must reference an entity_id or a block");
}

const spawnItem: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_item_spawn");
  const dimensionId = reader.string("dimension");
  const itemType = reader.string("item_type");
  const location = reader.vector3("location");
  const count = reader.optionalInteger("count");
  const properties = reader.optionalObject("properties");
  return ctx.scheduler.run(() => {
    const stack = buildItemStack(itemType, count, properties);
    const entity = resolveDimension(ctx.world, dimensionId).spawnItem(stack, location);
    return { entity: entitySummary(entity) };
  });
};

const getInventory: CommandHandler = (payload, ctx) => {
  const reference = readContainerRef(
    PayloadReader.open(payload, "mc_inventory_get").object_("container"),
  );
  return ctx.scheduler.run(() => ({
    inventory: containerSummary(requireContainer(ctx.world, reference)),
  }));
};

const setSlot: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_inventory_set_slot");
  const reference = readContainerRef(reader.object_("container"));
  const slot = reader.integer("slot");
  const itemType = reader.string("item_type");
  const count = reader.optionalInteger("count");
  const properties = reader.optionalObject("properties");
  return ctx.scheduler.run(() => {
    const container = requireContainer(ctx.world, reference);
    if (slot < 0 || slot >= container.size) {
      throw CommandError.invalidInput(`slot ${slot} is out of range (0..${container.size - 1})`);
    }
    const stack = buildItemStack(itemType, count, properties);
    container.setItem(slot, stack);
    return { slot, item: itemStackSummary(stack) };
  });
};

const clearSlot: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_inventory_clear_slot");
  const reference = readContainerRef(reader.object_("container"));
  const slot = reader.integer("slot");
  return ctx.scheduler.run(() => {
    const container = requireContainer(ctx.world, reference);
    if (slot < 0 || slot >= container.size) {
      throw CommandError.invalidInput(`slot ${slot} is out of range (0..${container.size - 1})`);
    }
    container.setItem(slot, undefined);
    return { slot, cleared: true };
  });
};

/** The inventory-domain handler table. */
export const inventoryHandlers: HandlerMap = {
  mc_item_spawn: spawnItem,
  mc_inventory_get: getInventory,
  mc_inventory_set_slot: setSlot,
  mc_inventory_clear_slot: clearSlot,
};
