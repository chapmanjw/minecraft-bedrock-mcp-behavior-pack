import { describe, expect, it } from "vitest";
import type { World } from "@minecraft/server";
import { CommandError } from "../../src/errors/command-error";
import type { EventPublisher } from "../../src/event-publisher";
import type { BridgeEvent } from "../../src/protocol";
import { createSubscriptionManager } from "../../src/subscriptions/subscription-manager";
import { createRecordingLogger } from "../support/fakes";

const SUBSCRIPTION_ID = "sub_01HX0000000000000000000000";

class FakeSignal<T> {
  private readonly listeners = new Set<(event: T) => void>();
  subscribe(callback: (event: T) => void): (event: T) => void {
    this.listeners.add(callback);
    return callback;
  }
  unsubscribe(callback: (event: T) => void): void {
    this.listeners.delete(callback);
  }
  fire(event: T): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

function fakeWorld(playerJoin: FakeSignal<{ playerId: string; playerName: string }>): World {
  return { afterEvents: { playerJoin }, beforeEvents: {} } as unknown as World;
}

function recordingPublisher(): EventPublisher & { events: BridgeEvent[] } {
  const events: BridgeEvent[] = [];
  return { events, enqueue: (event) => events.push(event) };
}

describe("createSubscriptionManager", () => {
  it("arms a listener and forwards fired events", () => {
    const signal = new FakeSignal<{ playerId: string; playerName: string }>();
    const publisher = recordingPublisher();
    const manager = createSubscriptionManager({
      world: fakeWorld(signal),
      events: publisher,
      logger: createRecordingLogger(),
    });

    manager.arm(SUBSCRIPTION_ID, "playerJoin", undefined);
    signal.fire({ playerId: "p1", playerName: "Steve" });

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.subscription_id).toBe(SUBSCRIPTION_ID);
    expect(publisher.events[0]?.event_type).toBe("playerJoin");
    expect(publisher.events[0]?.payload).toEqual({ player_id: "p1", player_name: "Steve" });
  });

  it("stops forwarding events once disarmed", () => {
    const signal = new FakeSignal<{ playerId: string; playerName: string }>();
    const publisher = recordingPublisher();
    const manager = createSubscriptionManager({
      world: fakeWorld(signal),
      events: publisher,
      logger: createRecordingLogger(),
    });

    manager.arm(SUBSCRIPTION_ID, "playerJoin", undefined);
    expect(manager.disarm(SUBSCRIPTION_ID)).toBe(true);
    signal.fire({ playerId: "p1", playerName: "Steve" });

    expect(publisher.events).toHaveLength(0);
  });

  it("is idempotent — disarming an unknown subscription returns false", () => {
    const manager = createSubscriptionManager({
      world: fakeWorld(new FakeSignal()),
      events: recordingPublisher(),
      logger: createRecordingLogger(),
    });
    expect(manager.disarm(SUBSCRIPTION_ID)).toBe(false);
  });

  it("applies a filter to fired events", () => {
    const signal = new FakeSignal<{ playerId: string; playerName: string }>();
    const publisher = recordingPublisher();
    const manager = createSubscriptionManager({
      world: fakeWorld(signal),
      events: publisher,
      logger: createRecordingLogger(),
    });

    manager.arm(SUBSCRIPTION_ID, "playerJoin", { player_name: "Steve" });
    signal.fire({ playerId: "p1", playerName: "Alex" });
    signal.fire({ playerId: "p2", playerName: "Steve" });

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.payload).toEqual({ player_id: "p2", player_name: "Steve" });
  });

  it("rejects an unsupported event type with UNSUPPORTED_CAPABILITY", () => {
    const manager = createSubscriptionManager({
      world: fakeWorld(new FakeSignal()),
      events: recordingPublisher(),
      logger: createRecordingLogger(),
    });
    try {
      manager.arm(SUBSCRIPTION_ID, "notARealEvent", undefined);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).code).toBe("UNSUPPORTED_CAPABILITY");
    }
  });
});
