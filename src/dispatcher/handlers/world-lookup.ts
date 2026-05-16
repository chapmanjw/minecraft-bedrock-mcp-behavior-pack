/**
 * Resolves wire identifiers — dimension names, entity ids, player names,
 * container references — to live Script API objects.
 *
 * A lookup that finds nothing throws a {@link CommandError} with the right
 * code: an unknown dimension is `INVALID_INPUT`, a missing entity or player is
 * `NOT_FOUND`. Handlers stay free of resolution boilerplate.
 */
import type { Container, Dimension, Entity, Player, World } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";

/** The dimension identifiers the bridge protocol accepts. */
export const DIMENSION_IDS = ["overworld", "nether", "the_end"] as const;
export type DimensionId = (typeof DIMENSION_IDS)[number];

/** Resolves a wire dimension name to a {@link Dimension}. */
export function resolveDimension(world: World, id: string): Dimension {
  try {
    return world.getDimension(id);
  } catch {
    throw CommandError.invalidInput(`unknown dimension '${id}'`);
  }
}

/** Resolves an entity runtime id, or throws `NOT_FOUND`. */
export function requireEntity(world: World, id: string): Entity {
  const entity = world.getEntity(id);
  if (entity === undefined) {
    throw CommandError.notFound(`no entity with id '${id}'`);
  }
  return entity;
}

/** Resolves an online player by name, or throws `NOT_FOUND`. */
export function requirePlayer(world: World, name: string): Player {
  const player = world.getAllPlayers().find((candidate) => candidate.name === name);
  if (player === undefined) {
    throw CommandError.notFound(`no online player named '${name}'`);
  }
  return player;
}

/** Whether an entity is a player. */
export function isPlayer(entity: Entity): entity is Player {
  return entity.typeId === "minecraft:player";
}

/**
 * Resolves an inventory {@link Container} from a container reference — either an
 * entity id or a block location.
 */
export function requireContainer(
  world: World,
  reference: {
    entityId?: string;
    block?: { dimension: string; location: { x: number; y: number; z: number } };
  },
): Container {
  if (reference.entityId !== undefined) {
    const entity = requireEntity(world, reference.entityId);
    const component = entity.getComponent("minecraft:inventory");
    const container = (component as { container?: Container } | undefined)?.container;
    if (container === undefined) {
      throw CommandError.invalidInput(`entity '${reference.entityId}' has no inventory container`);
    }
    return container;
  }
  if (reference.block !== undefined) {
    const dimension = resolveDimension(world, reference.block.dimension);
    const block = dimension.getBlock(reference.block.location);
    if (block === undefined) {
      throw CommandError.notFound("no block at the referenced container location");
    }
    const component = block.getComponent("minecraft:inventory");
    if (component?.container === undefined) {
      throw CommandError.invalidInput("the referenced block has no inventory container");
    }
    return component.container;
  }
  throw CommandError.invalidInput("container reference must name an entity_id or a block");
}
