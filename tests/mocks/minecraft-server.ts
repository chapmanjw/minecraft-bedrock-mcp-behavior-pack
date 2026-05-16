// Test mock for `@minecraft/server`. Wired in via the alias in vitest.config.ts.
// Only the value exports the behavior-pack code imports need to exist here;
// types come from the vendored declarations in `types/`.

export class BlockPermutation {
  private constructor(
    readonly typeId: string,
    private readonly states: Record<string, boolean | number | string>,
  ) {}

  static resolve(
    typeId: string,
    states: Record<string, boolean | number | string> = {},
  ): BlockPermutation {
    if (typeId.length === 0) throw new Error("empty block type id");
    return new BlockPermutation(typeId, states);
  }

  get type(): { id: string } {
    return { id: this.typeId };
  }

  getAllStates(): Record<string, boolean | number | string> {
    return { ...this.states };
  }

  getState(name: string): boolean | number | string | undefined {
    return this.states[name];
  }

  matches(typeId: string): boolean {
    return this.typeId === typeId;
  }
}

export class ItemStack {
  amount: number;
  nameTag: string | undefined = undefined;
  keepOnDeath = false;
  lockMode = "none";
  private lore: string[] = [];

  constructor(
    readonly typeId: string,
    amount = 1,
  ) {
    if (typeId.length === 0) throw new Error("empty item type id");
    this.amount = amount;
  }

  getLore(): string[] {
    return [...this.lore];
  }

  setLore(lore: string[] = []): void {
    this.lore = [...lore];
  }

  clone(): ItemStack {
    return new ItemStack(this.typeId, this.amount);
  }
}

export class MolangVariableMap {
  readonly floats = new Map<string, number>();
  setFloat(name: string, value: number): void {
    this.floats.set(name, value);
  }
}

export const GameMode = {
  Survival: "Survival",
  Creative: "Creative",
  Adventure: "Adventure",
  Spectator: "Spectator",
} as const;

export const WeatherType = { Clear: "Clear", Rain: "Rain", Thunder: "Thunder" } as const;

export const ItemLockMode = { none: "none", inventory: "inventory", slot: "slot" } as const;

export const StructureSaveMode = { Memory: "Memory", World: "World" } as const;

export const StructureRotation = {
  None: "None",
  Rotate90: "Rotate90",
  Rotate180: "Rotate180",
  Rotate270: "Rotate270",
} as const;

export const StructureMirrorAxis = { None: "None", X: "X", Z: "Z", XZ: "XZ" } as const;

export const StructureAnimationMode = { None: "None", Layers: "Layers", Blocks: "Blocks" } as const;

// The behavior pack reads `world` and `system` only from its entrypoint, which
// is not exercised by unit tests; handlers receive them through the context.
export const world = {};
export const system = {};
