/**
 * World handlers — world-level queries and mutations.
 *
 * Covers `mc_world_*`: time, weather, dimensions, chat, sound, and particles.
 */
import { MolangVariableMap, WeatherType, type RawMessage } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { DIMENSION_IDS, resolveDimension } from "./world-lookup";
import { vec } from "./conversions";

const WEATHER_TYPES = ["Clear", "Rain", "Thunder"] as const;

const WIRE_TO_WEATHER: Readonly<Record<string, WeatherType>> = {
  Clear: WeatherType.Clear,
  Rain: WeatherType.Rain,
  Thunder: WeatherType.Thunder,
};

/** Reads a `message` field that is either plain text or a rawtext object. */
function readMessage(reader: PayloadReader, key: string): string | RawMessage {
  const value = reader.raw(key);
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw CommandError.invalidInput(`${key} must be a string or a rawtext object`);
}

const getInfo: CommandHandler = (_payload, ctx) =>
  ctx.scheduler.run(() => ({
    // The Script API exposes neither the world name nor the Minecraft version.
    name: null,
    minecraft_version: null,
    day: ctx.world.getDay(),
    time_of_day: ctx.world.getTimeOfDay(),
    current_tick: ctx.scheduler.currentTick(),
    player_count: ctx.world.getAllPlayers().length,
    dimensions: [...DIMENSION_IDS],
  }));

const getTime: CommandHandler = (_payload, ctx) =>
  ctx.scheduler.run(() => ({
    time_of_day: ctx.world.getTimeOfDay(),
    absolute_time: ctx.world.getAbsoluteTime(),
    day: ctx.world.getDay(),
  }));

const getWeather: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_get_weather");
  const dimensionId = reader.string("dimension");
  return ctx.scheduler.run(() => {
    const dimension = resolveDimension(ctx.world, dimensionId);
    // `Dimension.getWeather` is a pre-release API — present only when the pack
    // depends on the beta `@minecraft/server` module. Fail with a clear,
    // coded error rather than a raw "not a function" TypeError.
    if (typeof dimension.getWeather !== "function") {
      throw CommandError.unsupported(
        "reading current weather requires the beta @minecraft/server module; " +
          "set the @minecraft/server dependency in manifest.json to its beta version",
      );
    }
    return { dimension: dimensionId, weather: dimension.getWeather() };
  });
};

const getDimensions: CommandHandler = () => Promise.resolve({ dimensions: [...DIMENSION_IDS] });

const getDimensionInfo: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_get_dimension_info");
  const dimensionId = reader.string("dimension");
  return ctx.scheduler.run(() => {
    const dimension = resolveDimension(ctx.world, dimensionId);
    return { id: dimension.id, height_range: dimension.heightRange };
  });
};

const setTime: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_set_time");
  const value = reader.integer("value");
  return ctx.scheduler.run(() => {
    ctx.world.setTimeOfDay(value);
    return { time_of_day: value };
  });
};

const setWeather: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_set_weather");
  const dimensionId = reader.string("dimension");
  const type = reader.enumValue("type", WEATHER_TYPES);
  const duration = reader.optionalInteger("duration");
  return ctx.scheduler.run(() => {
    const weather = WIRE_TO_WEATHER[type];
    if (weather === undefined) throw new Error(`unmapped weather type '${type}'`);
    resolveDimension(ctx.world, dimensionId).setWeather(weather, duration);
    return { dimension: dimensionId, type };
  });
};

const sendMessage: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_send_message");
  const target = reader.string("target");
  const message = readMessage(reader, "message");
  return ctx.scheduler.run(() => {
    if (target === "all") {
      ctx.world.sendMessage(message);
      return { delivered_to: "all" };
    }
    const player = ctx.world.getAllPlayers().find((candidate) => candidate.name === target);
    if (player === undefined) {
      return { delivered_to: target, online: false };
    }
    player.sendMessage(message);
    return { delivered_to: target, online: true };
  });
};

const playSound: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_play_sound");
  const dimensionId = reader.string("dimension");
  const sound = reader.string("sound");
  const location = reader.vector3("location");
  const options = reader.optionalObject("options");
  const volume = options?.optionalNumber("volume");
  const pitch = options?.optionalNumber("pitch");
  return ctx.scheduler.run(() => {
    resolveDimension(ctx.world, dimensionId).playSound(sound, location, { volume, pitch });
    return { sound, location: vec(location) };
  });
};

const spawnParticle: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_spawn_particle");
  const dimensionId = reader.string("dimension");
  const name = reader.string("name");
  const location = reader.vector3("location");
  const molang = reader.optionalRecord("molang_variables");
  return ctx.scheduler.run(() => {
    let variables: MolangVariableMap | undefined;
    if (molang !== undefined) {
      variables = new MolangVariableMap();
      for (const [key, value] of Object.entries(molang)) {
        if (typeof value !== "number") {
          throw new Error(`molang variable '${key}' must be a number`);
        }
        variables.setFloat(key, value);
      }
    }
    resolveDimension(ctx.world, dimensionId).spawnParticle(name, location, variables);
    return { name, location: vec(location) };
  });
};

/** The world-domain handler table. */
export const worldHandlers: HandlerMap = {
  mc_world_get_info: getInfo,
  mc_world_get_time: getTime,
  mc_world_get_weather: getWeather,
  mc_world_get_dimensions: getDimensions,
  mc_world_get_dimension_info: getDimensionInfo,
  mc_world_set_time: setTime,
  mc_world_set_weather: setWeather,
  mc_world_send_message: sendMessage,
  mc_world_play_sound: playSound,
  mc_world_spawn_particle: spawnParticle,
};
