import { describe, expect, it } from "vitest";
import { buildHandlerRegistry, EXPECTED_HANDLER_COUNT } from "../../src/dispatcher/handlers";

describe("buildHandlerRegistry", () => {
  it("assembles exactly the expected number of command kinds", () => {
    const registry = buildHandlerRegistry();
    expect(Object.keys(registry)).toHaveLength(EXPECTED_HANDLER_COUNT);
    expect(EXPECTED_HANDLER_COUNT).toBe(71);
  });

  it("names every kind with the mc_ tool-name prefix", () => {
    for (const kind of Object.keys(buildHandlerRegistry())) {
      expect(kind).toMatch(/^mc_[a-z_]+$/);
    }
  });

  it("does not register the six server-local tools", () => {
    const registry = buildHandlerRegistry();
    for (const serverLocal of [
      "mc_structure_file_read",
      "mc_structure_file_write",
      "mc_event_poll",
      "mc_event_list_subscriptions",
    ]) {
      expect(registry[serverLocal]).toBeUndefined();
    }
  });
});
