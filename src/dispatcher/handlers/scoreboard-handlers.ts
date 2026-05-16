/**
 * Scoreboard handlers — objective and score operations.
 *
 * Covers `mc_scoreboard_*`. The Script API addresses participants by a fake
 * player name string, which is how the bridge protocol carries them.
 */
import type { Scoreboard, ScoreboardObjective } from "@minecraft/server";
import { CommandError } from "../../errors/command-error";
import type { CommandHandler, HandlerMap } from "../command-handler";
import { PayloadReader } from "../payload";

function requireObjective(scoreboard: Scoreboard, id: string): ScoreboardObjective {
  const objective = scoreboard.getObjective(id);
  if (objective === undefined) {
    throw CommandError.notFound(`no scoreboard objective '${id}'`);
  }
  return objective;
}

const listObjectives: CommandHandler = (_payload, ctx) =>
  ctx.scheduler.run(() => ({
    objectives: ctx.world.scoreboard.getObjectives().map((objective) => ({
      id: objective.id,
      display_name: objective.displayName,
    })),
  }));

const addObjective: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_add_objective");
  const id = reader.string("id");
  const displayName = reader.optionalString("display_name");
  const criteria = reader.optionalString("criteria");
  if (criteria !== undefined && criteria !== "dummy") {
    throw CommandError.invalidInput("the Script API only supports the 'dummy' objective criteria");
  }
  return ctx.scheduler.run(() => {
    if (ctx.world.scoreboard.getObjective(id) !== undefined) {
      throw CommandError.invalidInput(`scoreboard objective '${id}' already exists`);
    }
    const objective = ctx.world.scoreboard.addObjective(id, displayName ?? id);
    return { id: objective.id, display_name: objective.displayName };
  });
};

const removeObjective: CommandHandler = (payload, ctx) => {
  const id = PayloadReader.open(payload, "mc_scoreboard_remove_objective").string("id");
  return ctx.scheduler.run(() => {
    const removed = ctx.world.scoreboard.removeObjective(
      requireObjective(ctx.world.scoreboard, id),
    );
    return { id, removed };
  });
};

const getScore: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_get_score");
  const objectiveId = reader.string("objective");
  const participant = reader.string("participant");
  return ctx.scheduler.run(() => {
    const objective = requireObjective(ctx.world.scoreboard, objectiveId);
    const score = objective.getScore(participant);
    return { objective: objectiveId, participant, score: score ?? null };
  });
};

const setScore: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_set_score");
  const objectiveId = reader.string("objective");
  const participant = reader.string("participant");
  const score = reader.integer("score");
  return ctx.scheduler.run(() => {
    requireObjective(ctx.world.scoreboard, objectiveId).setScore(participant, score);
    return { objective: objectiveId, participant, score };
  });
};

const addScore: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_add_score");
  const objectiveId = reader.string("objective");
  const participant = reader.string("participant");
  const amount = reader.integer("amount");
  return ctx.scheduler.run(() => {
    const objective = requireObjective(ctx.world.scoreboard, objectiveId);
    const score = (objective.getScore(participant) ?? 0) + amount;
    objective.setScore(participant, score);
    return { objective: objectiveId, participant, score };
  });
};

const resetParticipant: CommandHandler = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_reset_participant");
  const participant = reader.string("participant");
  const objectiveId = reader.optionalString("objective");
  return ctx.scheduler.run(() => {
    const objectives =
      objectiveId === undefined
        ? ctx.world.scoreboard.getObjectives()
        : [requireObjective(ctx.world.scoreboard, objectiveId)];
    let reset = 0;
    for (const objective of objectives) {
      if (objective.removeParticipant(participant)) reset += 1;
    }
    return { participant, objectives_reset: reset };
  });
};

/** The scoreboard-domain handler table. */
export const scoreboardHandlers: HandlerMap = {
  mc_scoreboard_list_objectives: listObjectives,
  mc_scoreboard_add_objective: addObjective,
  mc_scoreboard_remove_objective: removeObjective,
  mc_scoreboard_get_score: getScore,
  mc_scoreboard_set_score: setScore,
  mc_scoreboard_add_score: addScore,
  mc_scoreboard_reset_participant: resetParticipant,
};
