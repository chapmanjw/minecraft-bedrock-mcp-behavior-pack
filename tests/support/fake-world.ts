// A small in-memory fake of the Script API `world` surface, enough to exercise
// the world and block handlers. Only the slice the handlers touch is modeled.

import { BlockPermutation } from "@minecraft/server";

interface Vec {
  x: number;
  y: number;
  z: number;
}

class FakeBlock {
  permutation: BlockPermutation;
  constructor(
    readonly location: Vec,
    typeId = "minecraft:air",
  ) {
    this.permutation = BlockPermutation.resolve(typeId);
  }
  get typeId(): string {
    return this.permutation.type.id;
  }
  get isAir(): boolean {
    return this.typeId === "minecraft:air";
  }
  get isLiquid(): boolean {
    return this.typeId === "minecraft:water";
  }
  get isValid(): boolean {
    return true;
  }
  setPermutation(permutation: BlockPermutation): void {
    this.permutation = permutation;
  }
}

class FakeDimension {
  private readonly grid = new Map<string, FakeBlock>();
  weather = "Clear";
  readonly heightRange = { min: -64, max: 320 };
  constructor(readonly id: string) {}

  private key(location: Vec): string {
    return `${location.x},${location.y},${location.z}`;
  }

  getBlock(location: Vec): FakeBlock {
    const key = this.key(location);
    let block = this.grid.get(key);
    if (block === undefined) {
      block = new FakeBlock(location);
      this.grid.set(key, block);
    }
    return block;
  }

  getTopmostBlock(locationXZ: { x: number; z: number }): FakeBlock {
    return this.getBlock({ x: locationXZ.x, y: 64, z: locationXZ.z });
  }

  getWeather(): string {
    return this.weather;
  }

  setWeather(weather: string): void {
    this.weather = weather;
  }

  playSound(): void {}
  spawnParticle(): void {}
  runCommand(): { successCount: number } {
    return { successCount: 1 };
  }
}

/** A minimal fake of the Script API `world`. */
export class FakeWorld {
  private readonly dimensions = new Map<string, FakeDimension>();
  private timeOfDay = 1000;
  readonly messages: (string | object)[] = [];

  constructor() {
    for (const id of ["overworld", "nether", "the_end"]) {
      this.dimensions.set(id, new FakeDimension(id));
    }
  }

  getDimension(id: string): FakeDimension {
    const dimension = this.dimensions.get(id);
    if (dimension === undefined) throw new Error(`unknown dimension '${id}'`);
    return dimension;
  }

  getAllPlayers(): { name: string }[] {
    return [];
  }

  sendMessage(message: string | object): void {
    this.messages.push(message);
  }

  getDay(): number {
    return 7;
  }

  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  setTimeOfDay(value: number): void {
    this.timeOfDay = value;
  }

  getAbsoluteTime(): number {
    return 24000 * 7 + this.timeOfDay;
  }
}
