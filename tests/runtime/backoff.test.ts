import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackoff } from "../../src/runtime/backoff";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBackoff", () => {
  it("grows exponentially and caps at the maximum", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const backoff = createBackoff({ baseMs: 250, maxMs: 5000 });
    expect(backoff.nextDelayMs()).toBe(250);
    expect(backoff.nextDelayMs()).toBe(500);
    expect(backoff.nextDelayMs()).toBe(1000);
    expect(backoff.nextDelayMs()).toBe(2000);
    expect(backoff.nextDelayMs()).toBe(4000);
    expect(backoff.nextDelayMs()).toBe(5000);
    expect(backoff.nextDelayMs()).toBe(5000);
  });

  it("applies full jitter — a sample within [0, ceiling]", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const backoff = createBackoff({ baseMs: 250 });
    expect(backoff.nextDelayMs()).toBe(0);
  });

  it("counts failures and resets", () => {
    const backoff = createBackoff();
    backoff.nextDelayMs();
    backoff.nextDelayMs();
    expect(backoff.failureCount).toBe(2);
    backoff.reset();
    expect(backoff.failureCount).toBe(0);
  });
});
