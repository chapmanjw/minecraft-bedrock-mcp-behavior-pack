/**
 * Effect handlers — environmental effects.
 *
 * Covers `mc_explosion_create` and `mc_lightning_strike`.
 */
import type { ExplosionOptions } from "@minecraft/server";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { vec } from "./conversions";
import { requireEntity, resolveDimension } from "./world-lookup";

const createExplosion: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_explosion_create");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  const radius = reader.number("radius");
  const options = reader.optionalObject("options");
  const sourceEntityId = options?.optionalString("source_entity_id");
  return ctx.scheduler.run(() => {
    const explosionOptions: ExplosionOptions = {
      causesFire: options?.optionalBoolean("causes_fire"),
      breaksBlocks: options?.optionalBoolean("breaks_blocks"),
      allowUnderwater: options?.optionalBoolean("allow_underwater"),
    };
    if (sourceEntityId !== undefined) {
      explosionOptions.source = requireEntity(ctx.world, sourceEntityId);
    }
    const detonated = resolveDimension(ctx.world, dimensionId).createExplosion(
      location,
      radius,
      explosionOptions,
    );
    return { location: vec(location), radius, detonated };
  });
};

const strikeLightning: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_lightning_strike");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  return ctx.scheduler.run(() => {
    const entity = resolveDimension(ctx.world, dimensionId).spawnEntity(
      "minecraft:lightning_bolt",
      location,
    );
    return { location: vec(location), entity_id: entity.id };
  });
};

/** The effect-domain handler table. */
export const effectHandlers: HandlerMap = {
  mc_explosion_create: createExplosion,
  mc_lightning_strike: strikeLightning,
};
