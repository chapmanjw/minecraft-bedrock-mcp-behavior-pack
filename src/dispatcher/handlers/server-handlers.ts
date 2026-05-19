/**
 * Server administration handlers.
 *
 * Covers `mc_server_*`: reloading addons, reloading the whole world, saving
 * the world, and a status snapshot. Ticks-per-second is derived by sampling
 * `system.currentTick` against wall-clock time across a short interval.
 */
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";

/** Captured at module load — a close proxy for the pack's start time. */
const STARTED_AT = Date.now();

/** Wall-clock window over which TPS is sampled. */
const TPS_SAMPLE_MS = 1_000;
/** BDS targets this many ticks per second. */
const TARGET_TPS = 20;

/** Delay before `/reload all` fires, leaving time to report this command's result. */
const RELOAD_DELAY_MS = 1_500;

const reloadAddons: CommandHandler = (_payload, ctx) =>
  ctx.scheduler.run(() => {
    const result = ctx.world.getDimension("overworld").runCommand("reload");
    return { reloaded: result.successCount > 0 };
  });

const reloadWorld: CommandHandler = async (_payload, ctx) => {
  const onlinePlayers = await ctx.scheduler.run(() => {
    const players = ctx.world.getAllPlayers();
    if (players.length === 0) {
      throw CommandError.behaviorPack(
        "/reload all needs an online player to re-index packs; " +
          "restart the dedicated server instead",
        { reason: "no_player_online" },
      );
    }
    return players.length;
  });
  // `/reload all` reloads behavior and resource packs — re-indexing uploaded
  // `.mcstructure` files — rejoins every player, and reloads this very script.
  // Fire it a moment after this command's result has been reported, so the
  // command settles cleanly before the script context is torn down.
  void ctx.scheduler
    .delay(RELOAD_DELAY_MS)
    .then(() =>
      ctx.scheduler.run(() => {
        const [player] = ctx.world.getAllPlayers();
        player?.runCommand("reload all");
      }),
    )
    .catch(() => {
      // The world or script context is already tearing down — nothing to do.
    });
  return { reload_scheduled: true, online_players: onlinePlayers };
};

const saveWorld: CommandHandler = async (_payload, ctx) => {
  const overworld = () => ctx.world.getDimension("overworld");
  // `save hold` → `save query` → `save resume` is the BDS save handshake.
  await ctx.scheduler.run(() => overworld().runCommand("save hold"));
  await ctx.scheduler.delay(1_000);
  await ctx.scheduler.run(() => overworld().runCommand("save query"));
  await ctx.scheduler.delay(500);
  const resume = await ctx.scheduler.run(() => overworld().runCommand("save resume"));
  return { saved: resume.successCount > 0 };
};

const getStatus: CommandHandler = async (_payload, ctx) => {
  const tickStart = ctx.scheduler.currentTick();
  const timeStart = Date.now();
  await ctx.scheduler.delay(TPS_SAMPLE_MS);
  const elapsedMs = Date.now() - timeStart;
  const ticksElapsed = ctx.scheduler.currentTick() - tickStart;
  const tps = elapsedMs > 0 ? Math.min(TARGET_TPS, (ticksElapsed * 1_000) / elapsedMs) : TARGET_TPS;
  return ctx.scheduler.run(() => ({
    uptime_ms: Date.now() - STARTED_AT,
    online_players: ctx.world.getAllPlayers().length,
    current_tick: ctx.scheduler.currentTick(),
    tps: Math.round(tps * 100) / 100,
  }));
};

/** The server-domain handler table. */
export const serverHandlers: HandlerMap = {
  mc_server_reload_addons: reloadAddons,
  mc_server_reload_world: reloadWorld,
  mc_server_save_world: saveWorld,
  mc_server_get_status: getStatus,
};
