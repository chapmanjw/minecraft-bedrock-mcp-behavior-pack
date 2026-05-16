import { describe, expect, it } from "vitest";
import { createEventPublisher } from "../src/event-publisher";
import type { BridgeEvent } from "../src/protocol";
import type { BridgeTransport } from "../src/transport/http-transport";
import { TransportError } from "../src/transport/transport-error";
import { createFakeScheduler, createRecordingLogger, flushMicrotasks } from "./support/fakes";

function event(index: number): BridgeEvent {
  return {
    subscription_id: "sub_01HX0000000000000000000000",
    event_type: "playerJoin",
    occurred_at: "2026-05-15T12:00:00.000Z",
    payload: { index },
  };
}

function recordingTransport(failuresBeforeSuccess = 0): BridgeTransport & {
  delivered: BridgeEvent[];
} {
  const delivered: BridgeEvent[] = [];
  let calls = 0;
  return {
    delivered,
    handshake: () => Promise.reject(new Error("unused")),
    poll: () => Promise.reject(new Error("unused")),
    reportResult: () => Promise.resolve(),
    setPollTimeoutMs: () => {},
    reportEvents: (report) => {
      calls += 1;
      if (calls <= failuresBeforeSuccess) {
        return Promise.reject(new TransportError("bridge unreachable"));
      }
      delivered.push(...report.events);
      return Promise.resolve();
    },
  };
}

describe("createEventPublisher", () => {
  it("delivers a single buffered event after the accumulation window", async () => {
    const transport = recordingTransport();
    const publisher = createEventPublisher({
      transport,
      scheduler: createFakeScheduler(),
      logger: createRecordingLogger(),
    });

    publisher.enqueue(event(1));
    await flushMicrotasks();

    expect(transport.delivered).toHaveLength(1);
  });

  it("flushes a burst of events", async () => {
    const transport = recordingTransport();
    const publisher = createEventPublisher({
      transport,
      scheduler: createFakeScheduler(),
      logger: createRecordingLogger(),
    });

    for (let index = 0; index < 70; index += 1) publisher.enqueue(event(index));
    await flushMicrotasks();

    expect(transport.delivered).toHaveLength(70);
  });

  it("retries delivery after a transport failure", async () => {
    const transport = recordingTransport(1);
    const publisher = createEventPublisher({
      transport,
      scheduler: createFakeScheduler(),
      logger: createRecordingLogger(),
    });

    publisher.enqueue(event(1));
    await flushMicrotasks();

    expect(transport.delivered).toHaveLength(1);
  });
});
