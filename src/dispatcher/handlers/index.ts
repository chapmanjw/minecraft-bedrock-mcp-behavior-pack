/**
 * Assembles the complete `kind` → handler registry from the per-domain tables.
 *
 * The MCP server forwards exactly 72 command kinds to the behavior pack (the
 * other seven tools run on the server itself). The assembled registry is
 * asserted against that count at startup, so a duplicate key or a missing
 * handler fails loudly rather than silently dropping a command kind.
 */
import type { HandlerMap } from "../command-handler";
import { blockHandlers } from "./block-handlers";
import { commandHandlers } from "./command-handlers";
import { effectHandlers } from "./effect-handlers";
import { entityHandlers } from "./entity-handlers";
import { eventHandlers } from "./event-handlers";
import { inventoryHandlers } from "./inventory-handlers";
import { playerHandlers } from "./player-handlers";
import { propertyHandlers } from "./property-handlers";
import { scoreboardHandlers } from "./scoreboard-handlers";
import { serverHandlers } from "./server-handlers";
import { structureHandlers } from "./structure-handlers";
import { worldHandlers } from "./world-handlers";

/** The number of command kinds the MCP server forwards to the behavior pack. */
export const EXPECTED_HANDLER_COUNT = 72;

/**
 * Builds the frozen handler registry, asserting it covers exactly the expected
 * number of command kinds.
 */
export function buildHandlerRegistry(): HandlerMap {
  const registry: HandlerMap = {
    ...worldHandlers,
    ...blockHandlers,
    ...structureHandlers,
    ...entityHandlers,
    ...playerHandlers,
    ...inventoryHandlers,
    ...scoreboardHandlers,
    ...propertyHandlers,
    ...effectHandlers,
    ...eventHandlers,
    ...commandHandlers,
    ...serverHandlers,
  };
  const count = Object.keys(registry).length;
  if (count !== EXPECTED_HANDLER_COUNT) {
    throw new Error(
      `handler registry has ${count} kinds, expected ${EXPECTED_HANDLER_COUNT} — ` +
        "a domain table likely has a duplicate or missing key",
    );
  }
  return Object.freeze({ ...registry });
}
