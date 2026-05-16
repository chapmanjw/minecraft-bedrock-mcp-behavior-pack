import { describe, expect, it } from "vitest";
import {
  isProtocolCompatible,
  parseMajor,
  PROTOCOL_VERSION,
} from "../../src/protocol/protocol-version";

describe("parseMajor", () => {
  it("extracts the major version", () => {
    expect(parseMajor("1.0.0")).toBe(1);
    expect(parseMajor("2.7.13")).toBe(2);
    expect(parseMajor("3.0.0-beta.1")).toBe(3);
  });

  it("returns null for an unparseable version", () => {
    expect(parseMajor("not-a-version")).toBeNull();
    expect(parseMajor("")).toBeNull();
  });
});

describe("isProtocolCompatible", () => {
  it("accepts an equal major version", () => {
    expect(isProtocolCompatible(PROTOCOL_VERSION)).toBe(true);
    expect(isProtocolCompatible("1.9.9")).toBe(true);
  });

  it("rejects a different major version", () => {
    expect(isProtocolCompatible("2.0.0")).toBe(false);
    expect(isProtocolCompatible("0.9.0")).toBe(false);
  });

  it("rejects an unparseable version", () => {
    expect(isProtocolCompatible("garbage")).toBe(false);
  });
});
