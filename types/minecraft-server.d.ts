// Vendored ambient declarations for the `@minecraft/server` Script API.
//
// BDS provides the real implementation at runtime; the bundler marks the module
// external. These declarations cover the slice of the API the behavior pack
// uses. They intentionally mirror the official `@minecraft/server` types — see
// https://learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server/ —
// and can be swapped for the npm package if you prefer to track it directly.

declare module "@minecraft/server" {
  /** A point or vector in world space. */
  export interface Vector3 {
    x: number;
    y: number;
    z: number;
  }

  /** A two-axis rotation, in degrees. */
  export interface Vector2 {
    x: number;
    y: number;
  }

  /** An inclusive numeric range. */
  export interface NumberRange {
    min: number;
    max: number;
  }

  /** A Script API event signal: register and remove callbacks. */
  export interface EventSignal<T> {
    subscribe(callback: (event: T) => void): (event: T) => void;
    unsubscribe(callback: (event: T) => void): void;
  }

  export enum GameMode {
    Survival = "Survival",
    Creative = "Creative",
    Adventure = "Adventure",
    Spectator = "Spectator",
  }

  export enum WeatherType {
    Clear = "Clear",
    Rain = "Rain",
    Thunder = "Thunder",
  }

  export enum ItemLockMode {
    none = "none",
    inventory = "inventory",
    slot = "slot",
  }

  export enum StructureSaveMode {
    Memory = "Memory",
    World = "World",
  }

  export enum StructureRotation {
    None = "None",
    Rotate90 = "Rotate90",
    Rotate180 = "Rotate180",
    Rotate270 = "Rotate270",
  }

  export enum StructureMirrorAxis {
    None = "None",
    X = "X",
    Z = "Z",
    XZ = "XZ",
  }

  export enum StructureAnimationMode {
    None = "None",
    Layers = "Layers",
    Blocks = "Blocks",
  }

  /** A dynamic-property value. */
  export type DynamicPropertyValue = boolean | number | string | Vector3 | undefined;

  export class BlockType {
    readonly id: string;
  }

  export class BlockPermutation {
    readonly type: BlockType;
    static resolve(
      blockTypeId: string,
      states?: Record<string, boolean | number | string>,
    ): BlockPermutation;
    getAllStates(): Record<string, boolean | number | string>;
    getState(stateName: string): boolean | number | string | undefined;
    matches(blockTypeId: string, states?: Record<string, boolean | number | string>): boolean;
  }

  export class ItemStack {
    constructor(itemType: string, amount?: number);
    readonly typeId: string;
    amount: number;
    nameTag?: string;
    keepOnDeath: boolean;
    lockMode: ItemLockMode;
    getLore(): string[];
    setLore(loreList?: string[]): void;
    clone(): ItemStack;
  }

  export class ContainerSlot {
    readonly amount: number;
    readonly typeId?: string;
    hasItem(): boolean;
    getItem(): ItemStack | undefined;
    setItem(itemStack?: ItemStack): void;
  }

  export class Container {
    readonly size: number;
    readonly emptySlotsCount: number;
    getItem(slot: number): ItemStack | undefined;
    setItem(slot: number, itemStack?: ItemStack): void;
    getSlot(slot: number): ContainerSlot;
    addItem(itemStack: ItemStack): ItemStack | undefined;
    clearAll(): void;
  }

  export class EntityComponent {
    readonly typeId: string;
  }

  export class EntityInventoryComponent extends EntityComponent {
    readonly container?: Container;
  }

  export class EntityHealthComponent extends EntityComponent {
    readonly currentValue: number;
    readonly effectiveMax: number;
  }

  export class BlockInventoryComponent {
    readonly container?: Container;
  }

  export interface Effect {
    readonly typeId: string;
    readonly duration: number;
    readonly amplifier: number;
  }

  export class Block {
    readonly typeId: string;
    readonly type: BlockType;
    readonly permutation: BlockPermutation;
    readonly location: Vector3;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly isAir: boolean;
    readonly isLiquid: boolean;
    readonly isValid: boolean;
    readonly dimension: Dimension;
    setType(blockType: BlockType | string): void;
    setPermutation(permutation: BlockPermutation): void;
    getComponent(componentId: string): BlockInventoryComponent | undefined;
  }

  export interface TeleportOptions {
    dimension?: Dimension;
    rotation?: Vector2;
    facingLocation?: Vector3;
    keepVelocity?: boolean;
  }

  export interface EntityApplyDamageOptions {
    cause?: string;
    damagingEntity?: Entity;
  }

  export interface EntityEffectOptions {
    amplifier?: number;
    showParticles?: boolean;
  }

  export interface EntityQueryOptions {
    type?: string;
    name?: string;
    tags?: string[];
    excludeTags?: string[];
    families?: string[];
    location?: Vector3;
    minDistance?: number;
    maxDistance?: number;
    closest?: number;
    farthest?: number;
    volume?: Vector3;
  }

  export class Entity {
    readonly id: string;
    readonly typeId: string;
    readonly location: Vector3;
    readonly dimension: Dimension;
    readonly isValid: boolean;
    nameTag: string;
    getRotation(): Vector2;
    getVelocity(): Vector3;
    teleport(location: Vector3, options?: TeleportOptions): void;
    kill(): boolean;
    remove(): void;
    applyDamage(amount: number, options?: EntityApplyDamageOptions): boolean;
    addEffect(effectType: string, duration: number, options?: EntityEffectOptions): void;
    removeEffect(effectType: string): boolean;
    getEffects(): Effect[];
    addTag(tag: string): boolean;
    removeTag(tag: string): boolean;
    getTags(): string[];
    hasTag(tag: string): boolean;
    getComponent(componentId: "minecraft:inventory"): EntityInventoryComponent | undefined;
    getComponent(componentId: "minecraft:health"): EntityHealthComponent | undefined;
    getComponent(componentId: string): EntityComponent | undefined;
    getComponents(): EntityComponent[];
    runCommand(commandString: string): CommandResult;
    getDynamicProperty(identifier: string): DynamicPropertyValue;
    setDynamicProperty(identifier: string, value?: DynamicPropertyValue): void;
    getDynamicPropertyIds(): string[];
    clearDynamicProperties(): void;
  }

  export interface ScreenDisplayTitleOptions {
    fadeInDuration?: number;
    stayDuration?: number;
    fadeOutDuration?: number;
    subtitle?: string;
  }

  export class ScreenDisplay {
    setTitle(title: string, options?: ScreenDisplayTitleOptions): void;
    setActionBar(text: string): void;
  }

  export class Player extends Entity {
    readonly name: string;
    readonly onScreenDisplay: ScreenDisplay;
    setGameMode(gameMode: GameMode): void;
    getGameMode(): GameMode;
    playSound(soundId: string, soundOptions?: PlayerSoundOptions): void;
    sendMessage(message: string | RawMessage): void;
  }

  export interface RawMessage {
    rawtext?: RawMessage[];
    text?: string;
    translate?: string;
    with?: string[] | RawMessage;
  }

  export interface PlayerSoundOptions {
    location?: Vector3;
    volume?: number;
    pitch?: number;
  }

  export interface WorldSoundOptions {
    volume?: number;
    pitch?: number;
  }

  export interface ExplosionOptions {
    breaksBlocks?: boolean;
    causesFire?: boolean;
    allowUnderwater?: boolean;
    source?: Entity;
  }

  export interface CommandResult {
    readonly successCount: number;
  }

  export class Dimension {
    readonly id: string;
    readonly heightRange: NumberRange;
    getBlock(location: Vector3): Block | undefined;
    getTopmostBlock(locationXZ: { x: number; z: number }, minHeight?: number): Block | undefined;
    getEntities(options?: EntityQueryOptions): Entity[];
    getPlayers(options?: EntityQueryOptions): Player[];
    spawnEntity(identifier: string, location: Vector3): Entity;
    spawnItem(itemStack: ItemStack, location: Vector3): Entity;
    spawnParticle(effectName: string, location: Vector3, molangVariables?: MolangVariableMap): void;
    playSound(soundId: string, location: Vector3, soundOptions?: WorldSoundOptions): void;
    createExplosion(
      location: Vector3,
      radius: number,
      explosionOptions?: ExplosionOptions,
    ): boolean;
    setWeather(weatherType: WeatherType, duration?: number): void;
    /**
     * Reading the current weather is a pre-release Script API — it exists only
     * when the pack depends on the beta `@minecraft/server` module. Declared
     * optional so callers must feature-detect it before use.
     */
    getWeather?(): WeatherType;
    runCommand(commandString: string): CommandResult;
  }

  export class MolangVariableMap {
    setFloat(variableName: string, number: number): void;
  }

  export class ScoreboardIdentity {
    readonly id: number;
    readonly displayName: string;
  }

  export class ScoreboardObjective {
    readonly id: string;
    readonly displayName: string;
    getScore(participant: ScoreboardIdentity | string): number | undefined;
    setScore(participant: ScoreboardIdentity | string, score: number): void;
    removeParticipant(participant: ScoreboardIdentity | string): boolean;
    getParticipants(): ScoreboardIdentity[];
    hasParticipant(participant: ScoreboardIdentity | string): boolean;
  }

  export class Scoreboard {
    getObjective(objectiveId: string): ScoreboardObjective | undefined;
    getObjectives(): ScoreboardObjective[];
    addObjective(objectiveId: string, displayName?: string): ScoreboardObjective;
    removeObjective(objectiveId: string | ScoreboardObjective): boolean;
    getParticipants(): ScoreboardIdentity[];
  }

  export interface StructureCreateOptions {
    saveMode?: StructureSaveMode;
    includeBlocks?: boolean;
    includeEntities?: boolean;
  }

  export interface StructurePlaceOptions {
    rotation?: StructureRotation;
    mirror?: StructureMirrorAxis;
    integrity?: number;
    integritySeed?: string;
    includeBlocks?: boolean;
    includeEntities?: boolean;
    animationMode?: StructureAnimationMode;
    animationSeconds?: number;
    waterlogged?: boolean;
  }

  export class Structure {
    readonly id: string;
    readonly size: Vector3;
    readonly isValid: boolean;
    getBlockPermutation(location: Vector3): BlockPermutation | undefined;
    setBlockPermutation(location: Vector3, blockPermutation?: BlockPermutation): void;
  }

  export class StructureManager {
    get(identifier: string): Structure | undefined;
    getWorldStructureIds(): string[];
    createEmpty(identifier: string, size: Vector3, saveMode?: StructureSaveMode): Structure;
    createFromWorld(
      identifier: string,
      dimension: Dimension,
      from: Vector3,
      to: Vector3,
      options?: StructureCreateOptions,
    ): Structure;
    place(
      structure: string | Structure,
      dimension: Dimension,
      location: Vector3,
      options?: StructurePlaceOptions,
    ): void;
    delete(structure: string | Structure): boolean;
  }

  // ---- Events --------------------------------------------------------------

  export interface PlayerJoinAfterEvent {
    readonly playerId: string;
    readonly playerName: string;
  }
  export interface PlayerLeaveAfterEvent {
    readonly playerId: string;
    readonly playerName: string;
  }
  export interface PlayerSpawnAfterEvent {
    readonly player: Player;
    readonly initialSpawn: boolean;
  }
  export interface PlayerBreakBlockAfterEvent {
    readonly player: Player;
    readonly block: Block;
    readonly brokenBlockPermutation: BlockPermutation;
    readonly dimension: Dimension;
  }
  export interface PlayerPlaceBlockAfterEvent {
    readonly player: Player;
    readonly block: Block;
    readonly dimension: Dimension;
  }
  export interface EntitySpawnAfterEvent {
    readonly entity: Entity;
    readonly cause: string;
  }
  export interface EntityDieAfterEvent {
    readonly deadEntity: Entity;
    readonly damageSource: { cause: string; damagingEntity?: Entity };
  }
  export interface EntityHurtAfterEvent {
    readonly hurtEntity: Entity;
    readonly damage: number;
    readonly damageSource: { cause: string; damagingEntity?: Entity };
  }
  export interface EffectAddAfterEvent {
    readonly entity: Entity;
    readonly effect: Effect;
  }
  export interface ExplosionAfterEvent {
    readonly dimension: Dimension;
    readonly source?: Entity;
  }
  export interface WeatherChangeAfterEvent {
    readonly dimension: string;
    readonly newWeather: WeatherType;
    readonly previousWeather: WeatherType;
  }
  export interface ButtonPushAfterEvent {
    readonly block: Block;
    readonly dimension: Dimension;
    readonly source?: Entity;
  }
  export interface LeverActionAfterEvent {
    readonly block: Block;
    readonly dimension: Dimension;
    readonly isPowered: boolean;
    readonly player?: Player;
  }
  export interface PressurePlatePushAfterEvent {
    readonly block: Block;
    readonly dimension: Dimension;
    readonly source?: Entity;
  }
  export interface ItemUseAfterEvent {
    readonly itemStack?: ItemStack;
    readonly source: Player;
  }

  export interface WorldAfterEvents {
    readonly playerJoin: EventSignal<PlayerJoinAfterEvent>;
    readonly playerLeave: EventSignal<PlayerLeaveAfterEvent>;
    readonly playerSpawn: EventSignal<PlayerSpawnAfterEvent>;
    readonly playerBreakBlock: EventSignal<PlayerBreakBlockAfterEvent>;
    readonly playerPlaceBlock: EventSignal<PlayerPlaceBlockAfterEvent>;
    readonly entitySpawn: EventSignal<EntitySpawnAfterEvent>;
    readonly entityDie: EventSignal<EntityDieAfterEvent>;
    readonly entityHurt: EventSignal<EntityHurtAfterEvent>;
    readonly effectAdd: EventSignal<EffectAddAfterEvent>;
    readonly explosion: EventSignal<ExplosionAfterEvent>;
    readonly weatherChange: EventSignal<WeatherChangeAfterEvent>;
    readonly buttonPush: EventSignal<ButtonPushAfterEvent>;
    readonly leverAction: EventSignal<LeverActionAfterEvent>;
    readonly pressurePlatePush: EventSignal<PressurePlatePushAfterEvent>;
    readonly itemUse: EventSignal<ItemUseAfterEvent>;
  }

  export interface ChatSendBeforeEvent {
    readonly message: string;
    readonly sender: Player;
  }

  export interface WorldBeforeEvents {
    readonly chatSend: EventSignal<ChatSendBeforeEvent>;
  }

  export class World {
    readonly afterEvents: WorldAfterEvents;
    readonly beforeEvents: WorldBeforeEvents;
    readonly scoreboard: Scoreboard;
    readonly structureManager: StructureManager;
    getDimension(dimensionId: string): Dimension;
    getAllPlayers(): Player[];
    getPlayers(options?: EntityQueryOptions): Player[];
    getEntity(id: string): Entity | undefined;
    sendMessage(message: string | RawMessage): void;
    playSound(soundId: string, location: Vector3, soundOptions?: WorldSoundOptions): void;
    getDay(): number;
    getTimeOfDay(): number;
    setTimeOfDay(timeOfDay: number): void;
    getAbsoluteTime(): number;
    setAbsoluteTime(absoluteTime: number): void;
    getDynamicProperty(identifier: string): DynamicPropertyValue;
    setDynamicProperty(identifier: string, value?: DynamicPropertyValue): void;
    getDynamicPropertyIds(): string[];
    clearDynamicProperties(): void;
  }

  export interface SystemAfterEvents {
    readonly scriptEventReceive: EventSignal<{ id: string; message: string }>;
  }

  export class System {
    readonly currentTick: number;
    readonly afterEvents: SystemAfterEvents;
    run(callback: () => void): number;
    runJob(generator: Generator<void, void, void>): number;
    runTimeout(callback: () => void, tickDelay: number): number;
    runInterval(callback: () => void, tickInterval: number): number;
    clearRun(runId: number): void;
  }

  export const world: World;
  export const system: System;
}
