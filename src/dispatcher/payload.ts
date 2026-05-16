/**
 * Defensive payload narrowing for command handlers.
 *
 * The MCP server already validated every payload against the originating tool's
 * `zod` schema, but the behavior pack re-validates at its own trust boundary: a
 * handler should never index into `unknown`. Every accessor throws
 * `CommandError("INVALID_INPUT", ...)` on a mismatch, so a malformed payload
 * fails the command cleanly instead of crashing the handler.
 */
import type { Vector3 } from "@minecraft/server";
import { CommandError } from "../errors/command-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asVector3(value: unknown, label: string): Vector3 {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value["x"]) ||
    !isFiniteNumber(value["y"]) ||
    !isFiniteNumber(value["z"])
  ) {
    throw CommandError.invalidInput(`${label} must be a { x, y, z } vector of finite numbers`);
  }
  return { x: value["x"], y: value["y"], z: value["z"] };
}

/** A typed cursor over a command payload object. */
export class PayloadReader {
  private constructor(
    private readonly object: Record<string, unknown>,
    private readonly kind: string,
  ) {}

  /** Opens a reader over `payload`, requiring it to be an object. */
  static open(payload: unknown, kind: string): PayloadReader {
    if (!isRecord(payload)) {
      throw CommandError.invalidInput(`${kind} payload must be an object`);
    }
    return new PayloadReader(payload, kind);
  }

  private label(key: string): string {
    return `${this.kind}.${key}`;
  }

  /** Whether a key is present and not `undefined`. */
  has(key: string): boolean {
    return this.object[key] !== undefined;
  }

  /** The raw, unnarrowed value at `key` — for opaque pass-through payloads. */
  raw(key: string): unknown {
    return this.object[key];
  }

  string(key: string): string {
    const value = this.object[key];
    if (typeof value !== "string" || value.length === 0) {
      throw CommandError.invalidInput(`${this.label(key)} must be a non-empty string`);
    }
    return value;
  }

  optionalString(key: string): string | undefined {
    const value = this.object[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw CommandError.invalidInput(`${this.label(key)} must be a string`);
    }
    return value;
  }

  number(key: string): number {
    const value = this.object[key];
    if (!isFiniteNumber(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be a finite number`);
    }
    return value;
  }

  optionalNumber(key: string): number | undefined {
    return this.object[key] === undefined ? undefined : this.number(key);
  }

  integer(key: string): number {
    const value = this.number(key);
    if (!Number.isInteger(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be an integer`);
    }
    return value;
  }

  optionalInteger(key: string): number | undefined {
    return this.object[key] === undefined ? undefined : this.integer(key);
  }

  boolean(key: string): boolean {
    const value = this.object[key];
    if (typeof value !== "boolean") {
      throw CommandError.invalidInput(`${this.label(key)} must be a boolean`);
    }
    return value;
  }

  optionalBoolean(key: string): boolean | undefined {
    return this.object[key] === undefined ? undefined : this.boolean(key);
  }

  enumValue<T extends string>(key: string, allowed: readonly T[]): T {
    const value = this.string(key);
    if (!(allowed as readonly string[]).includes(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be one of ${allowed.join(", ")}`);
    }
    return value as T;
  }

  optionalEnum<T extends string>(key: string, allowed: readonly T[]): T | undefined {
    return this.object[key] === undefined ? undefined : this.enumValue(key, allowed);
  }

  vector3(key: string): Vector3 {
    if (this.object[key] === undefined) {
      throw CommandError.invalidInput(`${this.label(key)} is required`);
    }
    return asVector3(this.object[key], this.label(key));
  }

  optionalVector3(key: string): Vector3 | undefined {
    return this.object[key] === undefined
      ? undefined
      : asVector3(this.object[key], this.label(key));
  }

  stringArray(key: string): string[] {
    const value = this.object[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw CommandError.invalidInput(`${this.label(key)} must be an array of strings`);
    }
    return value as string[];
  }

  optionalStringArray(key: string): string[] | undefined {
    return this.object[key] === undefined ? undefined : this.stringArray(key);
  }

  /** Reads a nested object as its own reader. */
  object_(key: string): PayloadReader {
    const value = this.object[key];
    if (!isRecord(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be an object`);
    }
    return new PayloadReader(value, this.label(key));
  }

  optionalObject(key: string): PayloadReader | undefined {
    return this.object[key] === undefined ? undefined : this.object_(key);
  }

  /** Reads a free-form record (e.g. block states, molang variables). */
  record(key: string): Record<string, unknown> {
    const value = this.object[key];
    if (!isRecord(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be an object`);
    }
    return value;
  }

  optionalRecord(key: string): Record<string, unknown> | undefined {
    return this.object[key] === undefined ? undefined : this.record(key);
  }
}
