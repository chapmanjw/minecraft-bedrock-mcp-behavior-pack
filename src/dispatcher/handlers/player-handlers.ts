/**
 * Player handlers — player queries and player-specific mutations.
 *
 * Covers `mc_player_*`: listing, messaging, titles, game mode, inventory, the
 * camera, sound, and kicking. Camera and kick have no first-class Script API
 * and are issued as slash commands run as the player.
 */
import {
  GameMode,
  type Container,
  type Player,
  type RawMessage,
  type ScreenDisplayTitleOptions,
} from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { buildItemStack, containerSummary, vec } from "./conversions";
import { requirePlayer } from "./world-lookup";

const GAME_MODES = ["survival", "creative", "adventure", "spectator"] as const;

const WIRE_TO_GAME_MODE: Readonly<Record<string, GameMode>> = {
  survival: GameMode.Survival,
  creative: GameMode.Creative,
  adventure: GameMode.Adventure,
  spectator: GameMode.Spectator,
};

function readMessage(reader: PayloadReader, key: string): string | RawMessage {
  const value = reader.raw(key);
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw CommandError.invalidInput(`${key} must be a string or a rawtext object`);
}

function playerInventory(player: Player): Container {
  const component = player.getComponent("minecraft:inventory");
  if (component?.container === undefined) {
    throw CommandError.behaviorPack(`player '${player.name}' has no inventory container`);
  }
  return component.container;
}

/** Quotes a value for safe inclusion in a slash command argument. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

const listPlayers: CommandHandler = (_payload, ctx) =>
  ctx.scheduler.run(() => ({
    players: ctx.world.getAllPlayers().map((player) => ({
      name: player.name,
      id: player.id,
      location: vec(player.location),
      dimension: player.dimension.id,
      game_mode: player.getGameMode(),
    })),
  }));

const sendMessage: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_send_message");
  const name = reader.string("player");
  const message = readMessage(reader, "message");
  return ctx.scheduler.run(() => {
    requirePlayer(ctx.world, name).sendMessage(message);
    return { player: name };
  });
};

const sendTitle: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_send_title");
  const name = reader.string("player");
  const title = reader.string("title");
  const subtitle = reader.optionalString("subtitle");
  const options = reader.optionalObject("options");
  return ctx.scheduler.run(() => {
    const titleOptions: ScreenDisplayTitleOptions = {
      subtitle,
      fadeInDuration: options?.optionalInteger("fade_in_ticks"),
      stayDuration: options?.optionalInteger("stay_ticks"),
      fadeOutDuration: options?.optionalInteger("fade_out_ticks"),
    };
    requirePlayer(ctx.world, name).onScreenDisplay.setTitle(title, titleOptions);
    return { player: name };
  });
};

const sendActionbar: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_send_actionbar");
  const name = reader.string("player");
  const text = reader.string("text");
  return ctx.scheduler.run(() => {
    requirePlayer(ctx.world, name).onScreenDisplay.setActionBar(text);
    return { player: name };
  });
};

const setGamemode: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_set_gamemode");
  const name = reader.string("player");
  const mode = reader.enumValue("mode", GAME_MODES);
  return ctx.scheduler.run(() => {
    const gameMode = WIRE_TO_GAME_MODE[mode];
    if (gameMode === undefined) throw new Error(`unmapped game mode '${mode}'`);
    requirePlayer(ctx.world, name).setGameMode(gameMode);
    return { player: name, mode };
  });
};

const giveItem: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_give_item");
  const name = reader.string("player");
  const itemType = reader.string("item_type");
  const count = reader.optionalInteger("count");
  const properties = reader.optionalObject("properties");
  return ctx.scheduler.run(() => {
    const stack = buildItemStack(itemType, count, properties);
    const leftover = playerInventory(requirePlayer(ctx.world, name)).addItem(stack);
    return { player: name, item_type: itemType, fully_added: leftover === undefined };
  });
};

const clearInventory: CommandHandler = (payload, ctx) => {
  const name = PayloadReader.open(payload, "mc_player_clear_inventory").string("player");
  return ctx.scheduler.run(() => {
    playerInventory(requirePlayer(ctx.world, name)).clearAll();
    return { player: name };
  });
};

const getInventory: CommandHandler = (payload, ctx) => {
  const name = PayloadReader.open(payload, "mc_player_get_inventory").string("player");
  return ctx.scheduler.run(() => ({
    player: name,
    inventory: containerSummary(playerInventory(requirePlayer(ctx.world, name))),
  }));
};

const setCamera: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_set_camera");
  const name = reader.string("player");
  const options = reader.object_("options");
  const location = options.optionalVector3("location");
  const facing = options.optionalVector3("facing_location");
  const rotationReader = options.optionalObject("rotation");
  const easeSeconds = options.optionalNumber("ease_seconds");
  const easeType = options.optionalString("ease_type");
  const preset =
    options.optionalString("preset") ??
    (location !== undefined || rotationReader !== undefined ? "minecraft:free" : undefined);
  if (preset === undefined) {
    throw CommandError.invalidInput(
      "mc_player_set_camera requires options.preset, or a location/rotation",
    );
  }
  let command = `camera ${quote(name)} set ${preset}`;
  if (easeSeconds !== undefined) command += ` ease ${easeSeconds} ${easeType ?? "linear"}`;
  if (location !== undefined) command += ` pos ${location.x} ${location.y} ${location.z}`;
  if (rotationReader !== undefined) {
    command += ` rot ${rotationReader.number("x")} ${rotationReader.number("y")}`;
  }
  if (facing !== undefined) command += ` facing ${facing.x} ${facing.y} ${facing.z}`;
  return ctx.scheduler.run(() => {
    const result = requirePlayer(ctx.world, name).runCommand(command);
    return { player: name, preset, applied: result.successCount > 0 };
  });
};

const playSound: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_play_sound");
  const name = reader.string("player");
  const sound = reader.string("sound");
  const options = reader.optionalObject("options");
  const location = options?.optionalVector3("location");
  const volume = options?.optionalNumber("volume");
  const pitch = options?.optionalNumber("pitch");
  return ctx.scheduler.run(() => {
    requirePlayer(ctx.world, name).playSound(sound, { location, volume, pitch });
    return { player: name, sound };
  });
};

const kickPlayer: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_kick");
  const name = reader.string("player");
  const reason = reader.optionalString("reason");
  return ctx.scheduler.run(() => {
    const command = reason === undefined ? `kick ${quote(name)}` : `kick ${quote(name)} ${reason}`;
    const result = ctx.world.getDimension("overworld").runCommand(command);
    return { player: name, kicked: result.successCount > 0 };
  });
};

/** The player-domain handler table. */
export const playerHandlers: HandlerMap = {
  mc_player_list: listPlayers,
  mc_player_send_message: sendMessage,
  mc_player_send_title: sendTitle,
  mc_player_send_actionbar: sendActionbar,
  mc_player_set_gamemode: setGamemode,
  mc_player_give_item: giveItem,
  mc_player_clear_inventory: clearInventory,
  mc_player_get_inventory: getInventory,
  mc_player_set_camera: setCamera,
  mc_player_play_sound: playSound,
  mc_player_kick: kickPlayer,
};
