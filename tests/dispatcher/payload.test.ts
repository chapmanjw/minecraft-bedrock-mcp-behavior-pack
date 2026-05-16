import { describe, expect, it } from "vitest";
import { CommandError } from "../../src/errors/command-error";
import { PayloadReader } from "../../src/dispatcher/payload";

describe("PayloadReader", () => {
  it("rejects a non-object payload", () => {
    expect(() => PayloadReader.open(42, "mc_test")).toThrow(CommandError);
  });

  it("reads required and optional strings", () => {
    const reader = PayloadReader.open({ a: "x" }, "mc_test");
    expect(reader.string("a")).toBe("x");
    expect(reader.optionalString("b")).toBeUndefined();
    expect(() => reader.string("b")).toThrow(CommandError);
  });

  it("reads integers and rejects non-integers", () => {
    const reader = PayloadReader.open({ n: 5, f: 1.5 }, "mc_test");
    expect(reader.integer("n")).toBe(5);
    expect(() => reader.integer("f")).toThrow(CommandError);
  });

  it("reads a vector and rejects a malformed one", () => {
    const reader = PayloadReader.open({ loc: { x: 1, y: 2, z: 3 }, bad: { x: 1 } }, "mc_test");
    expect(reader.vector3("loc")).toEqual({ x: 1, y: 2, z: 3 });
    expect(() => reader.vector3("bad")).toThrow(CommandError);
  });

  it("validates enum membership", () => {
    const reader = PayloadReader.open({ mode: "replace" }, "mc_test");
    expect(reader.enumValue("mode", ["replace", "keep"] as const)).toBe("replace");
    const bad = PayloadReader.open({ mode: "explode" }, "mc_test");
    expect(() => bad.enumValue("mode", ["replace", "keep"] as const)).toThrow(CommandError);
  });

  it("reads nested objects as their own reader", () => {
    const reader = PayloadReader.open({ opts: { count: 3 } }, "mc_test");
    expect(reader.object_("opts").integer("count")).toBe(3);
    expect(reader.optionalObject("missing")).toBeUndefined();
  });

  it("surfaces INVALID_INPUT as the error code", () => {
    try {
      PayloadReader.open({}, "mc_test").string("missing");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).code).toBe("INVALID_INPUT");
    }
  });
});
