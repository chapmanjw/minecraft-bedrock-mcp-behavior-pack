/**
 * Dynamic property handlers — persistent key/value storage.
 *
 * Covers `mc_property_*`. A property is scoped to the world or to a single
 * entity; both expose the same dynamic-property surface.
 */
import type { DynamicPropertyValue, World } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { requireEntity } from "./world-lookup";

/** A dynamic-property holder — the world, or an entity. */
type PropertyTarget = Pick<
  World,
  "getDynamicProperty" | "setDynamicProperty" | "getDynamicPropertyIds" | "clearDynamicProperties"
>;

function resolveTarget(world: World, scope: unknown): PropertyTarget {
  if (scope === "world") return world;
  if (typeof scope === "object" && scope !== null) {
    const entityId = (scope as Record<string, unknown>)["entity_id"];
    if (typeof entityId === "string") return requireEntity(world, entityId);
  }
  throw CommandError.invalidInput("scope must be 'world' or { entity_id }");
}

function readPropertyValue(reader: PayloadReader): DynamicPropertyValue {
  const value = reader.raw("value");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["x"] === "number" &&
    typeof (value as Record<string, unknown>)["y"] === "number" &&
    typeof (value as Record<string, unknown>)["z"] === "number"
  ) {
    const vector = value as Record<string, number>;
    return { x: vector["x"] as number, y: vector["y"] as number, z: vector["z"] as number };
  }
  throw CommandError.invalidInput("value must be a string, number, boolean, or { x, y, z } vector");
}

const getProperty: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_property_get");
  const scope = reader.raw("scope");
  const name = reader.string("name");
  return ctx.scheduler.run(() => {
    const value = resolveTarget(ctx.world, scope).getDynamicProperty(name);
    return { name, value: value ?? null };
  });
};

const setProperty: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_property_set");
  const scope = reader.raw("scope");
  const name = reader.string("name");
  const value = readPropertyValue(reader);
  return ctx.scheduler.run(() => {
    resolveTarget(ctx.world, scope).setDynamicProperty(name, value);
    return { name, value };
  });
};

const listProperties: CommandHandler = (payload, ctx) => {
  const scope = PayloadReader.open(payload, "mc_property_list").raw("scope");
  return ctx.scheduler.run(() => ({
    names: resolveTarget(ctx.world, scope).getDynamicPropertyIds(),
  }));
};

const clearProperty: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_property_clear");
  const scope = reader.raw("scope");
  const name = reader.optionalString("name");
  return ctx.scheduler.run(() => {
    const target = resolveTarget(ctx.world, scope);
    if (name === undefined) {
      target.clearDynamicProperties();
      return { cleared: "all" };
    }
    target.setDynamicProperty(name, undefined);
    return { cleared: name };
  });
};

/** The dynamic-property handler table. */
export const propertyHandlers: HandlerMap = {
  mc_property_get: getProperty,
  mc_property_set: setProperty,
  mc_property_list: listProperties,
  mc_property_clear: clearProperty,
};
