/**
 * Entity handlers — entity queries and entity mutations.
 *
 * Covers `mc_entity_*`: lookup by id or query, spawning, removal, teleport,
 * damage, status effects, tags, component inspection, and running a command as
 * an entity.
 */
import type { EntityQueryOptions, TeleportOptions } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { entitySummary } from "./conversions";
import { DIMENSION_IDS, requireEntity, resolveDimension } from "./world-lookup";

function buildQueryOptions(query: PayloadReader): EntityQueryOptions {
  return {
    type: query.optionalString("type"),
    name: query.optionalString("name"),
    tags: query.optionalStringArray("tags"),
    excludeTags: query.optionalStringArray("exclude_tags"),
    families: query.optionalStringArray("families"),
    location: query.optionalVector3("location"),
    minDistance: query.optionalNumber("min_distance"),
    maxDistance: query.optionalNumber("max_distance"),
    closest: query.optionalInteger("closest"),
    farthest: query.optionalInteger("farthest"),
  };
}

const getEntity: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_get");
  const entityId = reader.optionalString("entity_id");
  const query = reader.optionalObject("query");
  if (entityId === undefined && query === undefined) {
    throw CommandError.invalidInput("mc_entity_get requires either entity_id or query");
  }
  return ctx.scheduler.run(() => {
    if (entityId !== undefined) {
      return { entities: [entitySummary(requireEntity(ctx.world, entityId))] };
    }
    const reader2 = query as PayloadReader;
    const options = buildQueryOptions(reader2);
    const dimensionId = reader2.optionalString("dimension");
    const limit = reader2.optionalInteger("limit");
    const dimensions = dimensionId === undefined ? DIMENSION_IDS : [dimensionId];
    let matched = dimensions.flatMap((id) => resolveDimension(ctx.world, id).getEntities(options));
    if (limit !== undefined) matched = matched.slice(0, limit);
    return { entities: matched.map(entitySummary) };
  });
};

const spawnEntity: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_spawn");
  const dimensionId = reader.string("dimension");
  const typeId = reader.string("type_id");
  const location = reader.vector3("location");
  const spawnEvent = reader.optionalString("spawn_event");
  return ctx.scheduler.run(() => {
    const identifier = spawnEvent === undefined ? typeId : `${typeId}<${spawnEvent}>`;
    const entity = resolveDimension(ctx.world, dimensionId).spawnEntity(identifier, location);
    return { entity: entitySummary(entity) };
  });
};

const removeEntity: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_remove");
  const entityId = reader.string("entity_id");
  const method = reader.optionalEnum("method", ["kill", "despawn"]) ?? "despawn";
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    if (method === "kill") entity.kill();
    else entity.remove();
    return { entity_id: entityId, method };
  });
};

const teleportEntity: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_teleport");
  const entityId = reader.string("entity_id");
  const location = reader.vector3("location");
  const options = reader.optionalObject("options");
  const dimensionId = options?.optionalString("dimension");
  const facingLocation = options?.optionalVector3("facing_location");
  const rotationReader = options?.optionalObject("rotation");
  const rotation =
    rotationReader === undefined
      ? undefined
      : { x: rotationReader.number("x"), y: rotationReader.number("y") };
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const teleportOptions: TeleportOptions = { rotation, facingLocation };
    if (dimensionId !== undefined) {
      teleportOptions.dimension = resolveDimension(ctx.world, dimensionId);
    }
    entity.teleport(location, teleportOptions);
    return { entity: entitySummary(entity) };
  });
};

const applyDamage: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_apply_damage");
  const entityId = reader.string("entity_id");
  const amount = reader.number("amount");
  const cause = reader.optionalString("cause");
  return ctx.scheduler.run(() => {
    const applied = requireEntity(ctx.world, entityId).applyDamage(amount, { cause });
    return { entity_id: entityId, amount, applied };
  });
};

const applyEffect: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_apply_effect");
  const entityId = reader.string("entity_id");
  const effect = reader.string("effect");
  const duration = reader.integer("duration_ticks");
  const amplifier = reader.optionalInteger("amplifier");
  const showParticles = reader.optionalBoolean("show_particles");
  return ctx.scheduler.run(() => {
    requireEntity(ctx.world, entityId).addEffect(effect, duration, { amplifier, showParticles });
    return { entity_id: entityId, effect };
  });
};

const removeEffect: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_remove_effect");
  const entityId = reader.string("entity_id");
  const effect = reader.string("effect");
  return ctx.scheduler.run(() => {
    const removed = requireEntity(ctx.world, entityId).removeEffect(effect);
    return { entity_id: entityId, effect, removed };
  });
};

const addTag: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_add_tag");
  const entityId = reader.string("entity_id");
  const tag = reader.string("tag");
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const added = entity.addTag(tag);
    return { entity_id: entityId, tag, added, tags: entity.getTags() };
  });
};

const removeTag: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_remove_tag");
  const entityId = reader.string("entity_id");
  const tag = reader.string("tag");
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const removed = entity.removeTag(tag);
    return { entity_id: entityId, tag, removed, tags: entity.getTags() };
  });
};

const getTags: CommandHandler = (payload, ctx) => {
  const entityId = PayloadReader.open(payload, "mc_entity_get_tags").string("entity_id");
  return ctx.scheduler.run(() => ({
    entity_id: entityId,
    tags: requireEntity(ctx.world, entityId).getTags(),
  }));
};

const getComponents: CommandHandler = (payload, ctx) => {
  const entityId = PayloadReader.open(payload, "mc_entity_get_components").string("entity_id");
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const components = entity.getComponents().map((component) => component.typeId);
    const healthComponent = entity.getComponent("minecraft:health");
    const health =
      healthComponent === undefined
        ? null
        : { current: healthComponent.currentValue, max: healthComponent.effectiveMax };
    return { entity_id: entityId, components, health };
  });
};

const runCommandAs: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_run_command_as");
  const entityId = reader.string("entity_id");
  const command = reader.string("command");
  return ctx.scheduler.run(() => {
    const result = requireEntity(ctx.world, entityId).runCommand(command);
    return { entity_id: entityId, success_count: result.successCount };
  });
};

/** The entity-domain handler table. */
export const entityHandlers: HandlerMap = {
  mc_entity_get: getEntity,
  mc_entity_spawn: spawnEntity,
  mc_entity_remove: removeEntity,
  mc_entity_teleport: teleportEntity,
  mc_entity_apply_damage: applyDamage,
  mc_entity_apply_effect: applyEffect,
  mc_entity_remove_effect: removeEffect,
  mc_entity_add_tag: addTag,
  mc_entity_remove_tag: removeTag,
  mc_entity_get_tags: getTags,
  mc_entity_get_components: getComponents,
  mc_entity_run_command_as: runCommandAs,
};
