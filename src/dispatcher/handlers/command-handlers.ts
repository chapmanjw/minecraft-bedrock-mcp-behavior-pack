/**
 * The raw slash-command escape hatch.
 *
 * `mc_run_command` runs a command as the server in a dimension, or as an entity
 * when an `executor` is given. The Script API also names its return type
 * `CommandResult` — unrelated to the bridge's `CommandResult` envelope — so the
 * `success_count` it carries is surfaced under a clear name.
 */
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";
import { requireEntity, resolveDimension } from "./world-lookup";

const runCommand: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_run_command");
  const command = reader.string("command");
  const dimensionId = reader.optionalString("dimension");
  const executor = reader.optionalString("executor");
  return ctx.scheduler.run(() => {
    const result =
      executor !== undefined
        ? requireEntity(ctx.world, executor).runCommand(command)
        : resolveDimension(ctx.world, dimensionId ?? "overworld").runCommand(command);
    return { success_count: result.successCount };
  });
};

/** The raw-command handler table. */
export const commandHandlers: HandlerMap = {
  mc_run_command: runCommand,
};
