/**
 * The table that maps a wire `event_type` to a concrete Script API event.
 *
 * Each binding knows two things: which `world` event signal to subscribe to,
 * and how to project that event's live Script API objects into a flat,
 * JSON-clonable payload. Raw events hold entity and block references with
 * methods; only a projected snapshot is safe to send over the wire.
 *
 * Most bindings use `afterEvents`. A few event types exist only as
 * `beforeEvents` (e.g. `chatSend`); those are bound as read-only observers —
 * the behavior pack never mutates a before-event or sets `.cancel`.
 */
import type { Block, Entity, EventSignal, Player, Vector3, World } from "@minecraft/server";

/** A type-erased event binding stored in the registry. */
export interface EventBinding {
  readonly eventType: string;
  readonly mode: "after" | "before";
  /**
   * Subscribes `emit` to the bound signal, returning an unsubscribe function.
   * `emit` receives the projected, JSON-clonable payload.
   */
  subscribe(world: World, emit: (payload: unknown) => void): () => void;
}

function vec(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

function entityRef(entity: Entity): Record<string, unknown> {
  return { id: entity.id, type_id: entity.typeId, location: vec(entity.location) };
}

function playerRef(player: Player): Record<string, unknown> {
  return { id: player.id, name: player.name, location: vec(player.location) };
}

function blockRef(block: Block): Record<string, unknown> {
  return { type_id: block.typeId, location: vec(block.location) };
}

function defineBinding<T>(
  eventType: string,
  mode: "after" | "before",
  select: (world: World) => EventSignal<T>,
  project: (event: T) => unknown,
): EventBinding {
  return {
    eventType,
    mode,
    subscribe(world, emit): () => void {
      const signal = select(world);
      const listener = (event: T): void => {
        emit(project(event));
      };
      signal.subscribe(listener);
      return () => {
        signal.unsubscribe(listener);
      };
    },
  };
}

const BINDINGS: readonly EventBinding[] = [
  defineBinding(
    "playerJoin",
    "after",
    (world) => world.afterEvents.playerJoin,
    (event) => ({ player_id: event.playerId, player_name: event.playerName }),
  ),
  defineBinding(
    "playerLeave",
    "after",
    (world) => world.afterEvents.playerLeave,
    (event) => ({ player_id: event.playerId, player_name: event.playerName }),
  ),
  defineBinding(
    "playerSpawn",
    "after",
    (world) => world.afterEvents.playerSpawn,
    (event) => ({ player: playerRef(event.player), initial_spawn: event.initialSpawn }),
  ),
  defineBinding(
    "playerBreakBlock",
    "after",
    (world) => world.afterEvents.playerBreakBlock,
    (event) => ({
      player: playerRef(event.player),
      block: blockRef(event.block),
      broken_block_type: event.brokenBlockPermutation.type.id,
    }),
  ),
  defineBinding(
    "playerPlaceBlock",
    "after",
    (world) => world.afterEvents.playerPlaceBlock,
    (event) => ({ player: playerRef(event.player), block: blockRef(event.block) }),
  ),
  defineBinding(
    "entitySpawn",
    "after",
    (world) => world.afterEvents.entitySpawn,
    (event) => ({ entity: entityRef(event.entity), cause: event.cause }),
  ),
  defineBinding(
    "entityDie",
    "after",
    (world) => world.afterEvents.entityDie,
    (event) => ({
      dead_entity: entityRef(event.deadEntity),
      cause: event.damageSource.cause,
      damaging_entity:
        event.damageSource.damagingEntity === undefined
          ? null
          : entityRef(event.damageSource.damagingEntity),
    }),
  ),
  defineBinding(
    "entityHurt",
    "after",
    (world) => world.afterEvents.entityHurt,
    (event) => ({
      hurt_entity: entityRef(event.hurtEntity),
      damage: event.damage,
      cause: event.damageSource.cause,
      damaging_entity:
        event.damageSource.damagingEntity === undefined
          ? null
          : entityRef(event.damageSource.damagingEntity),
    }),
  ),
  defineBinding(
    "effectAdd",
    "after",
    (world) => world.afterEvents.effectAdd,
    (event) => ({
      entity: entityRef(event.entity),
      effect: {
        type_id: event.effect.typeId,
        duration: event.effect.duration,
        amplifier: event.effect.amplifier,
      },
    }),
  ),
  defineBinding(
    "explosion",
    "after",
    (world) => world.afterEvents.explosion,
    (event) => ({
      dimension: event.dimension.id,
      source: event.source === undefined ? null : entityRef(event.source),
    }),
  ),
  defineBinding(
    "weatherChange",
    "after",
    (world) => world.afterEvents.weatherChange,
    (event) => ({
      dimension: event.dimension,
      new_weather: event.newWeather,
      previous_weather: event.previousWeather,
    }),
  ),
  defineBinding(
    "buttonPush",
    "after",
    (world) => world.afterEvents.buttonPush,
    (event) => ({
      block: blockRef(event.block),
      source: event.source === undefined ? null : entityRef(event.source),
    }),
  ),
  defineBinding(
    "leverAction",
    "after",
    (world) => world.afterEvents.leverAction,
    (event) => ({
      block: blockRef(event.block),
      is_powered: event.isPowered,
      player: event.player === undefined ? null : playerRef(event.player),
    }),
  ),
  defineBinding(
    "pressurePlatePush",
    "after",
    (world) => world.afterEvents.pressurePlatePush,
    (event) => ({
      block: blockRef(event.block),
      source: event.source === undefined ? null : entityRef(event.source),
    }),
  ),
  defineBinding(
    "itemUse",
    "after",
    (world) => world.afterEvents.itemUse,
    (event) => ({
      source: playerRef(event.source),
      item_type: event.itemStack?.typeId ?? null,
    }),
  ),
  defineBinding(
    "chatSend",
    "before",
    (world) => world.beforeEvents.chatSend,
    (event) => ({ sender: playerRef(event.sender), message: event.message }),
  ),
];

const REGISTRY: ReadonlyMap<string, EventBinding> = new Map(
  BINDINGS.map((binding) => [binding.eventType, binding]),
);

/** Looks up the binding for a wire `event_type`, or `undefined` if unsupported. */
export function getEventBinding(eventType: string): EventBinding | undefined {
  return REGISTRY.get(eventType);
}

/** Every event type the behavior pack can subscribe to. */
export function supportedEventTypes(): string[] {
  return [...REGISTRY.keys()];
}
