// Bedrock Bridge behavior pack — generated bundle. Do not edit.
// Edit the sources under src/ and rebuild with `npm run build`.
// https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack

// src/index.ts
import { system, world } from "@minecraft/server";

// src/runtime/backoff.ts
function createBackoff(options = {}) {
  const baseMs = options.baseMs ?? 250;
  const maxMs = options.maxMs ?? 5e3;
  let attempts = 0;
  return {
    get failureCount() {
      return attempts;
    },
    reset() {
      attempts = 0;
    },
    nextDelayMs() {
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempts);
      attempts += 1;
      return Math.round(Math.random() * ceiling);
    }
  };
}

// src/transport/transport-error.ts
var TransportError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TransportError";
    this.status = options.status;
    this.cause = options.cause;
  }
  /**
   * Whether this failure indicates the server may have restarted and lost the
   * pack's session — the poll loop responds by re-running the handshake.
   */
  get warrantsRehandshake() {
    return this.status === 401 || this.status === 403 || this.status === 409;
  }
};

// src/bridge-client.ts
var REHANDSHAKE_AFTER_POLL_FAILURES = 6;
var LOUD_FAILURE_INTERVAL = 5;
function createBridgeClient(deps) {
  const { transport, commandPump, scheduler, logger, handshakeRequest, onHandshakeAccepted } = deps;
  async function handshake() {
    const backoff = createBackoff();
    for (; ; ) {
      try {
        const response = await transport.handshake(handshakeRequest);
        if (!response.accepted) {
          logger.error("bridge refused the behavior pack \u2014 the poll loop will not start", {
            reason: response.reason,
            serverProtocolVersion: response.server_protocol_version,
            packProtocolVersion: handshakeRequest.protocol_version
          });
          return null;
        }
        logger.info("handshake accepted", {
          serverVersion: response.server_version,
          pollTimeoutMs: response.poll_timeout_ms,
          resyncSubscriptions: response.resync_subscriptions.length
        });
        return response;
      } catch (error) {
        const delayMs = backoff.nextDelayMs();
        logger.warn("handshake failed; retrying", {
          failures: backoff.failureCount,
          delayMs,
          reason: error instanceof Error ? error.message : String(error)
        });
        await scheduler.delay(delayMs);
      }
    }
  }
  async function poll() {
    const backoff = createBackoff();
    for (; ; ) {
      try {
        const response = await transport.poll();
        backoff.reset();
        if (response.commands.length > 0) {
          logger.debug("received commands", { count: response.commands.length });
          for (const command of response.commands) {
            commandPump.submit(command);
          }
        }
      } catch (error) {
        if (error instanceof TransportError && error.warrantsRehandshake) {
          logger.warn("poll indicates a lost session; re-running handshake", {
            status: error.status
          });
          return;
        }
        const delayMs = backoff.nextDelayMs();
        const failures = backoff.failureCount;
        const reason = error instanceof Error ? error.message : String(error);
        if (failures % LOUD_FAILURE_INTERVAL === 0) {
          logger.error("bridge poll has failed repeatedly", { failures, reason });
        } else {
          logger.warn("poll failed; backing off", { failures, delayMs, reason });
        }
        await scheduler.delay(delayMs);
        if (failures >= REHANDSHAKE_AFTER_POLL_FAILURES) {
          logger.warn("re-running handshake after sustained poll failures", { failures });
          return;
        }
      }
    }
  }
  return {
    async run() {
      commandPump.start();
      for (; ; ) {
        const accepted = await handshake();
        if (accepted === null) return;
        transport.setPollTimeoutMs(accepted.poll_timeout_ms);
        await onHandshakeAccepted(accepted);
        await poll();
      }
    }
  };
}

// src/errors/command-error.ts
var CommandError = class _CommandError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
  /** The command payload failed the handler's local validation. */
  static invalidInput(message, details) {
    return new _CommandError("INVALID_INPUT", message, details);
  }
  /** A referenced entity, structure, or other resource does not exist. */
  static notFound(message, details) {
    return new _CommandError("NOT_FOUND", message, details);
  }
  /** A required Script API module or feature is unavailable in this BDS build. */
  static unsupported(message, details) {
    return new _CommandError("UNSUPPORTED_CAPABILITY", message, details);
  }
  /** The Script API threw or returned an unexpected condition. */
  static behaviorPack(message, details) {
    return new _CommandError("BEHAVIOR_PACK_ERROR", message, details);
  }
  /** An unexpected internal failure. */
  static internal(message, details) {
    return new _CommandError("INTERNAL", message, details);
  }
};
function isCommandError(value) {
  return value instanceof CommandError;
}

// src/generated/module-versions.ts
var MODULE_VERSIONS = {
  "@minecraft/server": "2.6.0",
  "@minecraft/server-net": "1.0.0-beta",
  "@minecraft/server-admin": "1.0.0-beta"
};
var BEHAVIOR_PACK_VERSION = "0.1.0";

// src/capabilities/capability-probe.ts
function detectFeatures(world2) {
  const features = /* @__PURE__ */ new Set();
  const structureManager = world2.structureManager;
  if (typeof structureManager["getWorldStructureIds"] === "function") {
    features.add("structure.list");
  }
  return features;
}
function probeCapabilities(world2, logger) {
  const scriptModules = Object.entries(MODULE_VERSIONS).map(([name, version]) => ({
    name,
    version
  }));
  const features = detectFeatures(world2);
  logger.info("capability probe complete", {
    modules: scriptModules.map((module) => `${module.name}@${module.version}`),
    features: [...features]
  });
  return {
    scriptModules,
    supports: (feature) => features.has(feature),
    requireFeature: (feature) => {
      if (!features.has(feature)) {
        throw CommandError.unsupported(`this BDS build does not support capability '${feature}'`);
      }
    }
  };
}

// src/command-pump.ts
function createCommandPump(deps) {
  const { dispatcher, resultReporter, logger } = deps;
  const queue = [];
  let wake = null;
  let started = false;
  function waitForWork() {
    return new Promise((resolve) => {
      wake = resolve;
    });
  }
  async function process(entry) {
    const { command, receivedAt } = entry;
    if (Date.now() - receivedAt > command.deadline_ms) {
      logger.warn("skipping command past its deadline", {
        commandId: command.id,
        kind: command.kind,
        deadlineMs: command.deadline_ms
      });
      resultReporter.report({
        id: command.id,
        status: "error",
        error: {
          code: "BEHAVIOR_PACK_ERROR",
          message: "command exceeded its deadline before execution"
        }
      });
      return;
    }
    const result = await dispatcher.dispatch(command);
    resultReporter.report(result);
  }
  async function loop() {
    for (; ; ) {
      const entry = queue.shift();
      if (entry === void 0) {
        await waitForWork();
        continue;
      }
      try {
        await process(entry);
      } catch (error) {
        logger.error("unexpected failure in command pump", {
          commandId: entry.command.id,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return {
    submit(command) {
      queue.push({ command, receivedAt: Date.now() });
      if (wake !== null) {
        const resume = wake;
        wake = null;
        resume();
      }
    },
    start() {
      if (started) return;
      started = true;
      void loop();
    }
  };
}

// src/config/config.ts
import { secrets, variables } from "@minecraft/server-admin";
var ConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
};
var VARIABLE_BRIDGE_URL = "bridge_url";
var VARIABLE_LOG_LEVEL = "bridge_log_level";
var SECRET_AGENT_TOKEN = "bridge_agent_token";
var LOG_LEVELS = /* @__PURE__ */ new Set(["error", "warn", "info", "debug"]);
function readBaseUrl() {
  const value = variables.get(VARIABLE_BRIDGE_URL);
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`variables.json must define a non-empty string '${VARIABLE_BRIDGE_URL}'`);
  }
  if (!/^https?:\/\//.test(value)) {
    throw new ConfigError(`'${VARIABLE_BRIDGE_URL}' must be an http(s) URL, got '${value}'`);
  }
  return value;
}
function readToken() {
  const value = secrets.get(SECRET_AGENT_TOKEN);
  if (value === void 0) {
    throw new ConfigError(`secrets.json must define '${SECRET_AGENT_TOKEN}'`);
  }
  return value;
}
function readLogLevel() {
  const value = variables.get(VARIABLE_LOG_LEVEL);
  if (value === void 0) return "info";
  if (typeof value !== "string" || !LOG_LEVELS.has(value)) {
    throw new ConfigError(`'${VARIABLE_LOG_LEVEL}' must be one of error, warn, info, debug`);
  }
  return value;
}
function loadConfig() {
  return {
    baseUrl: readBaseUrl(),
    token: readToken(),
    logLevel: readLogLevel()
  };
}

// src/protocol/protocol-version.ts
var PROTOCOL_VERSION = "1.0.0";

// src/protocol/ids.ts
var COMMAND_ID_PATTERN = /^cmd_[0-9A-HJKMNP-TV-Z]{26}$/;
var SUBSCRIPTION_ID_PATTERN = /^sub_[0-9A-HJKMNP-TV-Z]{26}$/;
function isCommandId(value) {
  return COMMAND_ID_PATTERN.test(value);
}
function isSubscriptionId(value) {
  return SUBSCRIPTION_ID_PATTERN.test(value);
}

// src/protocol/result.ts
function okResult(id, result) {
  return { id, status: "ok", result };
}
function errorResult(id, code, message, details) {
  const error = details === void 0 ? { code, message } : { code, message, details };
  return { id, status: "error", error };
}

// src/protocol/event.ts
var EVENT_BATCH_MAX = 256;

// src/protocol/validation.ts
var ProtocolDecodeError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtocolDecodeError";
  }
};
function fail(message) {
  throw new ProtocolDecodeError(message);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value, what) {
  if (!isRecord(value)) fail(`${what} must be an object`);
  return value;
}
function str(object, key, what) {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`${what}.${key} must be a non-empty string`);
  }
  return value;
}
function posInt(object, key, what) {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`${what}.${key} must be a positive integer`);
  }
  return value;
}
function arr(object, key, what) {
  const value = object[key];
  if (!Array.isArray(value)) fail(`${what}.${key} must be an array`);
  return value;
}
function bool(object, key, what) {
  const value = object[key];
  if (typeof value !== "boolean") fail(`${what}.${key} must be a boolean`);
  return value;
}
function decodeCommand(value) {
  const object = record(value, "command");
  const id = str(object, "id", "command");
  if (!isCommandId(id)) fail(`command.id '${id}' is not a cmd_<ULID> identifier`);
  return {
    id,
    kind: str(object, "kind", "command"),
    payload: object["payload"],
    issued_at: str(object, "issued_at", "command"),
    deadline_ms: posInt(object, "deadline_ms", "command")
  };
}
function decodePollResponse(value) {
  const object = record(value, "poll response");
  return {
    commands: arr(object, "commands", "poll response").map(decodeCommand),
    server_time: str(object, "server_time", "poll response")
  };
}
function decodeResyncSubscription(value) {
  const object = record(value, "resync subscription");
  const subscriptionId = str(object, "subscription_id", "resync subscription");
  if (!isSubscriptionId(subscriptionId)) {
    fail(`resync subscription_id '${subscriptionId}' is not a sub_<ULID> identifier`);
  }
  const base = {
    subscription_id: subscriptionId,
    event_type: str(object, "event_type", "resync subscription")
  };
  return "filter" in object ? { ...base, filter: object["filter"] } : base;
}
function decodeHandshakeResponse(value) {
  const object = record(value, "handshake response");
  const accepted = bool(object, "accepted", "handshake response");
  if (!accepted) {
    return {
      accepted: false,
      reason: str(object, "reason", "handshake response"),
      server_protocol_version: str(object, "server_protocol_version", "handshake response")
    };
  }
  return {
    accepted: true,
    server_version: str(object, "server_version", "handshake response"),
    protocol_version: str(object, "protocol_version", "handshake response"),
    poll_timeout_ms: posInt(object, "poll_timeout_ms", "handshake response"),
    resync_subscriptions: arr(object, "resync_subscriptions", "handshake response").map(
      decodeResyncSubscription
    )
  };
}

// src/dispatcher/error-mapping.ts
var SCRIPT_API_ERROR_CODES = {
  LocationOutOfWorldBoundariesError: "INVALID_INPUT",
  ArgumentOutOfBoundsError: "INVALID_INPUT",
  PropertyOutOfBoundsError: "INVALID_INPUT",
  EntityQueryError: "INVALID_INPUT",
  NamespaceNameError: "INVALID_INPUT",
  InvalidContainerSlotError: "INVALID_INPUT",
  InvalidArgumentError: "INVALID_INPUT",
  InvalidEntityError: "NOT_FOUND",
  InvalidStructureError: "NOT_FOUND",
  LocationInUnloadedChunkError: "BEHAVIOR_PACK_ERROR",
  UnloadedChunksError: "BEHAVIOR_PACK_ERROR"
};
function mapError(error) {
  if (isCommandError(error)) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) {
    const mapped = SCRIPT_API_ERROR_CODES[error.name];
    return {
      code: mapped ?? "BEHAVIOR_PACK_ERROR",
      message: error.message.length > 0 ? error.message : error.name,
      details: void 0
    };
  }
  return {
    code: "INTERNAL",
    message: `non-error value thrown: ${String(error)}`,
    details: void 0
  };
}

// src/dispatcher/dispatcher.ts
function createDispatcher(handlers, services) {
  const kinds = Object.keys(handlers);
  return {
    kinds,
    async dispatch(command) {
      const handler = handlers[command.kind];
      if (handler === void 0) {
        return errorResult(
          command.id,
          "UNSUPPORTED_CAPABILITY",
          `behavior pack does not implement command kind '${command.kind}'`
        );
      }
      try {
        const result = await handler(command.payload, {
          ...services,
          deadlineMs: command.deadline_ms
        });
        return okResult(command.id, result === void 0 ? {} : result);
      } catch (error) {
        const mapped = mapError(error);
        services.logger.warn("command handler failed", {
          commandId: command.id,
          kind: command.kind,
          code: mapped.code,
          reason: mapped.message
        });
        return errorResult(command.id, mapped.code, mapped.message, mapped.details);
      }
    }
  };
}

// src/dispatcher/payload.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function asVector3(value, label) {
  if (!isRecord2(value) || !isFiniteNumber(value["x"]) || !isFiniteNumber(value["y"]) || !isFiniteNumber(value["z"])) {
    throw CommandError.invalidInput(`${label} must be a { x, y, z } vector of finite numbers`);
  }
  return { x: value["x"], y: value["y"], z: value["z"] };
}
var PayloadReader = class _PayloadReader {
  constructor(object, kind) {
    this.object = object;
    this.kind = kind;
  }
  /** Opens a reader over `payload`, requiring it to be an object. */
  static open(payload, kind) {
    if (!isRecord2(payload)) {
      throw CommandError.invalidInput(`${kind} payload must be an object`);
    }
    return new _PayloadReader(payload, kind);
  }
  label(key) {
    return `${this.kind}.${key}`;
  }
  /** Whether a key is present and not `undefined`. */
  has(key) {
    return this.object[key] !== void 0;
  }
  /** The raw, unnarrowed value at `key` — for opaque pass-through payloads. */
  raw(key) {
    return this.object[key];
  }
  string(key) {
    const value = this.object[key];
    if (typeof value !== "string" || value.length === 0) {
      throw CommandError.invalidInput(`${this.label(key)} must be a non-empty string`);
    }
    return value;
  }
  optionalString(key) {
    const value = this.object[key];
    if (value === void 0) return void 0;
    if (typeof value !== "string") {
      throw CommandError.invalidInput(`${this.label(key)} must be a string`);
    }
    return value;
  }
  number(key) {
    const value = this.object[key];
    if (!isFiniteNumber(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be a finite number`);
    }
    return value;
  }
  optionalNumber(key) {
    return this.object[key] === void 0 ? void 0 : this.number(key);
  }
  integer(key) {
    const value = this.number(key);
    if (!Number.isInteger(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be an integer`);
    }
    return value;
  }
  optionalInteger(key) {
    return this.object[key] === void 0 ? void 0 : this.integer(key);
  }
  boolean(key) {
    const value = this.object[key];
    if (typeof value !== "boolean") {
      throw CommandError.invalidInput(`${this.label(key)} must be a boolean`);
    }
    return value;
  }
  optionalBoolean(key) {
    return this.object[key] === void 0 ? void 0 : this.boolean(key);
  }
  enumValue(key, allowed) {
    const value = this.string(key);
    if (!allowed.includes(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be one of ${allowed.join(", ")}`);
    }
    return value;
  }
  optionalEnum(key, allowed) {
    return this.object[key] === void 0 ? void 0 : this.enumValue(key, allowed);
  }
  vector3(key) {
    if (this.object[key] === void 0) {
      throw CommandError.invalidInput(`${this.label(key)} is required`);
    }
    return asVector3(this.object[key], this.label(key));
  }
  optionalVector3(key) {
    return this.object[key] === void 0 ? void 0 : asVector3(this.object[key], this.label(key));
  }
  stringArray(key) {
    const value = this.object[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw CommandError.invalidInput(`${this.label(key)} must be an array of strings`);
    }
    return value;
  }
  optionalStringArray(key) {
    return this.object[key] === void 0 ? void 0 : this.stringArray(key);
  }
  /** Reads a nested object as its own reader. */
  object_(key) {
    const value = this.object[key];
    if (!isRecord2(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be an object`);
    }
    return new _PayloadReader(value, this.label(key));
  }
  optionalObject(key) {
    return this.object[key] === void 0 ? void 0 : this.object_(key);
  }
  /** Reads a free-form record (e.g. block states, molang variables). */
  record(key) {
    const value = this.object[key];
    if (!isRecord2(value)) {
      throw CommandError.invalidInput(`${this.label(key)} must be an object`);
    }
    return value;
  }
  optionalRecord(key) {
    return this.object[key] === void 0 ? void 0 : this.record(key);
  }
};

// src/dispatcher/handlers/conversions.ts
import {
  BlockPermutation,
  ItemLockMode,
  ItemStack
} from "@minecraft/server";

// src/dispatcher/handlers/world-lookup.ts
var DIMENSION_IDS = ["overworld", "nether", "the_end"];
function resolveDimension(world2, id) {
  try {
    return world2.getDimension(id);
  } catch {
    throw CommandError.invalidInput(`unknown dimension '${id}'`);
  }
}
function requireEntity(world2, id) {
  const entity = world2.getEntity(id);
  if (entity === void 0) {
    throw CommandError.notFound(`no entity with id '${id}'`);
  }
  return entity;
}
function requirePlayer(world2, name) {
  const player = world2.getAllPlayers().find((candidate) => candidate.name === name);
  if (player === void 0) {
    throw CommandError.notFound(`no online player named '${name}'`);
  }
  return player;
}
function isPlayer(entity) {
  return entity.typeId === "minecraft:player";
}
function requireContainer(world2, reference) {
  if (reference.entityId !== void 0) {
    const entity = requireEntity(world2, reference.entityId);
    const component = entity.getComponent("minecraft:inventory");
    const container = component?.container;
    if (container === void 0) {
      throw CommandError.invalidInput(`entity '${reference.entityId}' has no inventory container`);
    }
    return container;
  }
  if (reference.block !== void 0) {
    const dimension = resolveDimension(world2, reference.block.dimension);
    const block = dimension.getBlock(reference.block.location);
    if (block === void 0) {
      throw CommandError.notFound("no block at the referenced container location");
    }
    const component = block.getComponent("minecraft:inventory");
    if (component?.container === void 0) {
      throw CommandError.invalidInput("the referenced block has no inventory container");
    }
    return component.container;
  }
  throw CommandError.invalidInput("container reference must name an entity_id or a block");
}

// src/dispatcher/handlers/conversions.ts
function vec(v) {
  return { x: v.x, y: v.y, z: v.z };
}
function entitySummary(entity) {
  const summary = {
    id: entity.id,
    type_id: entity.typeId,
    location: vec(entity.location),
    dimension: entity.dimension.id,
    rotation: entity.getRotation(),
    tags: entity.getTags(),
    name_tag: entity.nameTag
  };
  if (isPlayer(entity)) {
    summary["name"] = entity.name;
  }
  return summary;
}
function blockSummary(block) {
  return {
    type_id: block.typeId,
    states: block.permutation.getAllStates(),
    location: vec(block.location),
    is_air: block.isAir,
    is_liquid: block.isLiquid
  };
}
var LOCK_MODE_TO_WIRE = {
  [ItemLockMode.none]: "none",
  [ItemLockMode.slot]: "lock_in_slot",
  [ItemLockMode.inventory]: "lock_in_inventory"
};
var WIRE_TO_LOCK_MODE = {
  none: ItemLockMode.none,
  lock_in_slot: ItemLockMode.slot,
  lock_in_inventory: ItemLockMode.inventory
};
function itemStackSummary(item) {
  return {
    type_id: item.typeId,
    amount: item.amount,
    name_tag: item.nameTag ?? null,
    lore: item.getLore(),
    keep_on_death: item.keepOnDeath,
    lock_mode: LOCK_MODE_TO_WIRE[item.lockMode] ?? "none"
  };
}
function containerSummary(container) {
  const slots = [];
  for (let slot = 0; slot < container.size; slot += 1) {
    const item = container.getItem(slot);
    if (item !== void 0) {
      slots.push({ slot, ...itemStackSummary(item) });
    }
  }
  return { size: container.size, empty_slots: container.emptySlotsCount, items: slots };
}
function coerceBlockStates(states) {
  const coerced = {};
  for (const [name, value] of Object.entries(states)) {
    if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
      throw CommandError.invalidInput(`block state '${name}' must be a boolean, number, or string`);
    }
    coerced[name] = value;
  }
  return coerced;
}
function buildBlockPermutation(blockType, states) {
  try {
    return BlockPermutation.resolve(
      blockType,
      states === void 0 ? void 0 : coerceBlockStates(states)
    );
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw CommandError.invalidInput(
      `cannot resolve block '${blockType}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function buildItemStack(itemType, count, properties) {
  let stack;
  try {
    stack = new ItemStack(itemType, count ?? 1);
  } catch (error) {
    throw CommandError.invalidInput(
      `cannot create item '${itemType}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (properties === void 0) return stack;
  const nameTag = properties.optionalString("name_tag");
  if (nameTag !== void 0) stack.nameTag = nameTag;
  const lore = properties.optionalStringArray("lore");
  if (lore !== void 0) stack.setLore(lore);
  const keepOnDeath = properties.optionalBoolean("keep_on_death");
  if (keepOnDeath !== void 0) stack.keepOnDeath = keepOnDeath;
  const lockMode = properties.optionalEnum("lock_mode", [
    "none",
    "lock_in_slot",
    "lock_in_inventory"
  ]);
  if (lockMode !== void 0) {
    const mode = WIRE_TO_LOCK_MODE[lockMode];
    if (mode !== void 0) stack.lockMode = mode;
  }
  return stack;
}

// src/dispatcher/handlers/block-handlers.ts
var PAGE_SIZE = 1024;
var MAX_SCAN_PER_PAGE = 16384;
var YIELD_INTERVAL = 2048;
function readBox(reader) {
  const from = reader.vector3("from");
  const to = reader.vector3("to");
  return {
    min: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
    max: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) }
  };
}
function boxVolume(box) {
  return (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1);
}
function readFilter(reader) {
  if (reader === void 0) return void 0;
  return {
    include: reader.optionalStringArray("include"),
    exclude: reader.optionalStringArray("exclude")
  };
}
function matchesFilter(typeId, filter) {
  if (filter === void 0) return true;
  if (filter.include !== void 0 && !filter.include.includes(typeId)) return false;
  if (filter.exclude !== void 0 && filter.exclude.includes(typeId)) return false;
  return true;
}
function getBlockSafe(dimension, location) {
  try {
    return dimension.getBlock(location);
  } catch {
    return void 0;
  }
}
function isPerimeter(box, x, y, z) {
  return x === box.min.x || x === box.max.x || y === box.min.y || y === box.max.y || z === box.min.z || z === box.max.z;
}
var getBlock = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_get");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  return ctx.scheduler.run(() => {
    const block = getBlockSafe(resolveDimension(ctx.world, dimensionId), location);
    if (block === void 0)
      throw CommandError.notFound("no block at the location (unloaded chunk?)");
    return blockSummary(block);
  });
};
var getTop = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_get_top");
  const dimensionId = reader.string("dimension");
  const x = reader.integer("x");
  const z = reader.integer("z");
  return ctx.scheduler.run(() => {
    const block = resolveDimension(ctx.world, dimensionId).getTopmostBlock({ x, z });
    if (block === void 0) throw CommandError.notFound("no topmost block in the column");
    return blockSummary(block);
  });
};
var setBlock = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_set");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  const blockType = reader.string("block_type");
  const states = reader.optionalRecord("states");
  return ctx.scheduler.run(() => {
    const permutation = buildBlockPermutation(blockType, states);
    const block = getBlockSafe(resolveDimension(ctx.world, dimensionId), location);
    if (block === void 0)
      throw CommandError.notFound("no block at the location (unloaded chunk?)");
    block.setPermutation(permutation);
    return { location, block_type: blockType };
  });
};
var getVolume = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_get_volume");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const filter = readFilter(reader.optionalObject("filter"));
  const cursorRaw = reader.optionalString("cursor");
  const start = cursorRaw === void 0 ? 0 : Number(cursorRaw);
  if (!Number.isInteger(start) || start < 0) {
    throw CommandError.invalidInput(`cursor '${cursorRaw}' is not a valid page cursor`);
  }
  const dimension = resolveDimension(ctx.world, dimensionId);
  const spanX = box.max.x - box.min.x + 1;
  const spanY = box.max.y - box.min.y + 1;
  const spanZ = box.max.z - box.min.z + 1;
  const total = spanX * spanY * spanZ;
  return ctx.scheduler.runJob(function* collect() {
    const blocks = [];
    let index = start;
    let scanned = 0;
    while (index < total && blocks.length < PAGE_SIZE && scanned < MAX_SCAN_PER_PAGE) {
      const location = {
        x: box.min.x + Math.floor(index / (spanY * spanZ)),
        y: box.min.y + Math.floor(index / spanZ) % spanY,
        z: box.min.z + index % spanZ
      };
      const block = getBlockSafe(dimension, location);
      if (block !== void 0 && matchesFilter(block.typeId, filter)) {
        blocks.push(blockSummary(block));
      }
      index += 1;
      scanned += 1;
      if (scanned % YIELD_INTERVAL === 0) yield;
    }
    return { blocks, cursor: index < total ? String(index) : null, volume: total };
  });
};
var containsBlock = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_contains");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const filter = readFilter(reader.object_("filter"));
  const dimension = resolveDimension(ctx.world, dimensionId);
  return ctx.scheduler.runJob(function* scan() {
    let processed = 0;
    for (let x = box.min.x; x <= box.max.x; x += 1) {
      for (let y = box.min.y; y <= box.max.y; y += 1) {
        for (let z = box.min.z; z <= box.max.z; z += 1) {
          const block = getBlockSafe(dimension, { x, y, z });
          if (block !== void 0 && matchesFilter(block.typeId, filter)) {
            return { contains: true, match: blockSummary(block) };
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { contains: false, match: null };
  });
};
var fillBlocks = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_fill");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const blockType = reader.string("block_type");
  const states = reader.optionalRecord("states");
  const options = reader.optionalObject("options");
  const mode = options?.optionalEnum("mode", ["replace", "keep", "hollow", "outline"]) ?? "replace";
  const filter = readFilter(options?.optionalObject("filter"));
  const dimension = resolveDimension(ctx.world, dimensionId);
  const fillPermutation = buildBlockPermutation(blockType, states);
  const airPermutation = buildBlockPermutation("minecraft:air", void 0);
  return ctx.scheduler.runJob(function* fill() {
    let changed = 0;
    let processed = 0;
    for (let x = box.min.x; x <= box.max.x; x += 1) {
      for (let y = box.min.y; y <= box.max.y; y += 1) {
        for (let z = box.min.z; z <= box.max.z; z += 1) {
          const perimeter = isPerimeter(box, x, y, z);
          let target;
          if (mode === "hollow") target = perimeter ? fillPermutation : airPermutation;
          else if (mode === "outline") target = perimeter ? fillPermutation : void 0;
          else target = fillPermutation;
          if (target !== void 0) {
            const block = getBlockSafe(dimension, { x, y, z });
            if (block !== void 0 && matchesFilter(block.typeId, filter)) {
              if (mode !== "keep" || block.isAir) {
                block.setPermutation(target);
                changed += 1;
              }
            }
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { mode, blocks_changed: changed, volume: boxVolume(box) };
  });
};
var replaceBlocks = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_replace");
  const dimensionId = reader.string("dimension");
  const box = readBox(reader);
  const sourceFilter = readFilter(reader.object_("source_filter"));
  const replacement = reader.object_("replacement");
  const blockType = replacement.string("block_type");
  const states = replacement.optionalRecord("states");
  const dimension = resolveDimension(ctx.world, dimensionId);
  const permutation = buildBlockPermutation(blockType, states);
  return ctx.scheduler.runJob(function* replace() {
    let changed = 0;
    let processed = 0;
    for (let x = box.min.x; x <= box.max.x; x += 1) {
      for (let y = box.min.y; y <= box.max.y; y += 1) {
        for (let z = box.min.z; z <= box.max.z; z += 1) {
          const block = getBlockSafe(dimension, { x, y, z });
          if (block !== void 0 && matchesFilter(block.typeId, sourceFilter)) {
            block.setPermutation(permutation);
            changed += 1;
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { block_type: blockType, blocks_changed: changed, volume: boxVolume(box) };
  });
};
var cloneBlocks = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_block_clone");
  const sourceDimensionId = reader.string("source_dimension");
  const sourceBox = (() => {
    const from = reader.vector3("source_from");
    const to = reader.vector3("source_to");
    return {
      min: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
      max: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) }
    };
  })();
  const destinationDimensionId = reader.string("destination_dimension");
  const destination = reader.vector3("destination_location");
  const options = reader.optionalObject("options");
  const mode = options?.optionalEnum("mode", ["replace", "masked"]) ?? "replace";
  const sourceDimension = resolveDimension(ctx.world, sourceDimensionId);
  const destinationDimension = resolveDimension(ctx.world, destinationDimensionId);
  return ctx.scheduler.runJob(function* clone() {
    let copied = 0;
    let processed = 0;
    for (let x = sourceBox.min.x; x <= sourceBox.max.x; x += 1) {
      for (let y = sourceBox.min.y; y <= sourceBox.max.y; y += 1) {
        for (let z = sourceBox.min.z; z <= sourceBox.max.z; z += 1) {
          const source = getBlockSafe(sourceDimension, { x, y, z });
          if (source !== void 0 && (mode !== "masked" || !source.isAir)) {
            const target = getBlockSafe(destinationDimension, {
              x: destination.x + (x - sourceBox.min.x),
              y: destination.y + (y - sourceBox.min.y),
              z: destination.z + (z - sourceBox.min.z)
            });
            if (target !== void 0) {
              target.setPermutation(source.permutation);
              copied += 1;
            }
          }
          processed += 1;
          if (processed % YIELD_INTERVAL === 0) yield;
        }
      }
    }
    return { mode, blocks_copied: copied, entities_cloned: false };
  });
};
var blockHandlers = {
  mc_block_get: getBlock,
  mc_block_get_volume: getVolume,
  mc_block_get_top: getTop,
  mc_block_contains: containsBlock,
  mc_block_set: setBlock,
  mc_block_fill: fillBlocks,
  mc_block_clone: cloneBlocks,
  mc_block_replace: replaceBlocks
};

// src/dispatcher/handlers/command-handlers.ts
var runCommand = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_run_command");
  const command = reader.string("command");
  const dimensionId = reader.optionalString("dimension");
  const executor = reader.optionalString("executor");
  return ctx.scheduler.run(() => {
    const result = executor !== void 0 ? requireEntity(ctx.world, executor).runCommand(command) : resolveDimension(ctx.world, dimensionId ?? "overworld").runCommand(command);
    return { success_count: result.successCount };
  });
};
var commandHandlers = {
  mc_run_command: runCommand
};

// src/dispatcher/handlers/effect-handlers.ts
var createExplosion = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_explosion_create");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  const radius = reader.number("radius");
  const options = reader.optionalObject("options");
  const sourceEntityId = options?.optionalString("source_entity_id");
  return ctx.scheduler.run(() => {
    const explosionOptions = {
      causesFire: options?.optionalBoolean("causes_fire"),
      breaksBlocks: options?.optionalBoolean("breaks_blocks"),
      allowUnderwater: options?.optionalBoolean("allow_underwater")
    };
    if (sourceEntityId !== void 0) {
      explosionOptions.source = requireEntity(ctx.world, sourceEntityId);
    }
    const detonated = resolveDimension(ctx.world, dimensionId).createExplosion(
      location,
      radius,
      explosionOptions
    );
    return { location: vec(location), radius, detonated };
  });
};
var strikeLightning = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_lightning_strike");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  return ctx.scheduler.run(() => {
    const entity = resolveDimension(ctx.world, dimensionId).spawnEntity(
      "minecraft:lightning_bolt",
      location
    );
    return { location: vec(location), entity_id: entity.id };
  });
};
var effectHandlers = {
  mc_explosion_create: createExplosion,
  mc_lightning_strike: strikeLightning
};

// src/dispatcher/handlers/entity-handlers.ts
function buildQueryOptions(query) {
  return {
    type: query.optionalString("type"),
    name: query.optionalString("name"),
    tags: query.optionalStringArray("tags"),
    excludeTags: query.optionalStringArray("exclude_tags"),
    families: query.optionalStringArray("families"),
    location: query.optionalVector3("location"),
    minDistance: query.optionalNumber("min_distance"),
    maxDistance: query.optionalNumber("max_distance"),
    closest: query.optionalInteger("closest"),
    farthest: query.optionalInteger("farthest")
  };
}
var getEntity = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_get");
  const entityId = reader.optionalString("entity_id");
  const query = reader.optionalObject("query");
  if (entityId === void 0 && query === void 0) {
    throw CommandError.invalidInput("mc_entity_get requires either entity_id or query");
  }
  return ctx.scheduler.run(() => {
    if (entityId !== void 0) {
      return { entities: [entitySummary(requireEntity(ctx.world, entityId))] };
    }
    const reader2 = query;
    const options = buildQueryOptions(reader2);
    const dimensionId = reader2.optionalString("dimension");
    const limit = reader2.optionalInteger("limit");
    const dimensions = dimensionId === void 0 ? DIMENSION_IDS : [dimensionId];
    let matched = dimensions.flatMap((id) => resolveDimension(ctx.world, id).getEntities(options));
    if (limit !== void 0) matched = matched.slice(0, limit);
    return { entities: matched.map(entitySummary) };
  });
};
var spawnEntity = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_spawn");
  const dimensionId = reader.string("dimension");
  const typeId = reader.string("type_id");
  const location = reader.vector3("location");
  const spawnEvent = reader.optionalString("spawn_event");
  return ctx.scheduler.run(() => {
    const identifier = spawnEvent === void 0 ? typeId : `${typeId}<${spawnEvent}>`;
    const entity = resolveDimension(ctx.world, dimensionId).spawnEntity(identifier, location);
    return { entity: entitySummary(entity) };
  });
};
var removeEntity = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_remove");
  const entityId = reader.string("entity_id");
  const method = reader.optionalEnum("method", ["kill", "despawn"]) ?? "despawn";
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    if (method === "kill") entity.kill();
    else entity.remove();
    return { entity_id: entityId, method };
  });
};
var teleportEntity = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_teleport");
  const entityId = reader.string("entity_id");
  const location = reader.vector3("location");
  const options = reader.optionalObject("options");
  const dimensionId = options?.optionalString("dimension");
  const facingLocation = options?.optionalVector3("facing_location");
  const rotationReader = options?.optionalObject("rotation");
  const rotation = rotationReader === void 0 ? void 0 : { x: rotationReader.number("x"), y: rotationReader.number("y") };
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const teleportOptions = { rotation, facingLocation };
    if (dimensionId !== void 0) {
      teleportOptions.dimension = resolveDimension(ctx.world, dimensionId);
    }
    entity.teleport(location, teleportOptions);
    return { entity: entitySummary(entity) };
  });
};
var applyDamage = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_apply_damage");
  const entityId = reader.string("entity_id");
  const amount = reader.number("amount");
  const cause = reader.optionalString("cause");
  return ctx.scheduler.run(() => {
    const applied = requireEntity(ctx.world, entityId).applyDamage(amount, { cause });
    return { entity_id: entityId, amount, applied };
  });
};
var applyEffect = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_apply_effect");
  const entityId = reader.string("entity_id");
  const effect = reader.string("effect");
  const duration = reader.integer("duration_ticks");
  const amplifier = reader.optionalInteger("amplifier");
  const showParticles = reader.optionalBoolean("show_particles");
  return ctx.scheduler.run(() => {
    requireEntity(ctx.world, entityId).addEffect(effect, duration, { amplifier, showParticles });
    return { entity_id: entityId, effect };
  });
};
var removeEffect = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_remove_effect");
  const entityId = reader.string("entity_id");
  const effect = reader.string("effect");
  return ctx.scheduler.run(() => {
    const removed = requireEntity(ctx.world, entityId).removeEffect(effect);
    return { entity_id: entityId, effect, removed };
  });
};
var addTag = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_add_tag");
  const entityId = reader.string("entity_id");
  const tag = reader.string("tag");
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const added = entity.addTag(tag);
    return { entity_id: entityId, tag, added, tags: entity.getTags() };
  });
};
var removeTag = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_remove_tag");
  const entityId = reader.string("entity_id");
  const tag = reader.string("tag");
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const removed = entity.removeTag(tag);
    return { entity_id: entityId, tag, removed, tags: entity.getTags() };
  });
};
var getTags = (payload, ctx) => {
  const entityId = PayloadReader.open(payload, "mc_entity_get_tags").string("entity_id");
  return ctx.scheduler.run(() => ({
    entity_id: entityId,
    tags: requireEntity(ctx.world, entityId).getTags()
  }));
};
var getComponents = (payload, ctx) => {
  const entityId = PayloadReader.open(payload, "mc_entity_get_components").string("entity_id");
  return ctx.scheduler.run(() => {
    const entity = requireEntity(ctx.world, entityId);
    const components = entity.getComponents().map((component) => component.typeId);
    const healthComponent = entity.getComponent("minecraft:health");
    const health = healthComponent === void 0 ? null : { current: healthComponent.currentValue, max: healthComponent.effectiveMax };
    return { entity_id: entityId, components, health };
  });
};
var runCommandAs = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_entity_run_command_as");
  const entityId = reader.string("entity_id");
  const command = reader.string("command");
  return ctx.scheduler.run(() => {
    const result = requireEntity(ctx.world, entityId).runCommand(command);
    return { entity_id: entityId, success_count: result.successCount };
  });
};
var entityHandlers = {
  mc_entity_get: getEntity,
  mc_entity_spawn: spawnEntity,
  mc_entity_remove: removeEntity,
  mc_entity_teleport: teleportEntity,
  mc_entity_apply_damage: applyDamage,
  mc_entity_apply_effect: applyEffect,
  mc_entity_remove_effect: removeEffect,
  mc_entity_add_tag: addTag,
  mc_entity_remove_tag: removeTag,
  mc_entity_get_tags: getTags,
  mc_entity_get_components: getComponents,
  mc_entity_run_command_as: runCommandAs
};

// src/dispatcher/handlers/event-handlers.ts
var subscribe = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_event_subscribe");
  const subscriptionId = reader.string("subscription_id");
  const eventType = reader.string("event_type");
  const filter = reader.raw("filter");
  return ctx.scheduler.run(() => {
    ctx.subscriptions.arm(subscriptionId, eventType, filter);
    return {};
  });
};
var unsubscribe = (payload, ctx) => {
  const subscriptionId = PayloadReader.open(payload, "mc_event_unsubscribe").string(
    "subscription_id"
  );
  return ctx.scheduler.run(() => {
    ctx.subscriptions.disarm(subscriptionId);
    return {};
  });
};
var eventHandlers = {
  mc_event_subscribe: subscribe,
  mc_event_unsubscribe: unsubscribe
};

// src/dispatcher/handlers/inventory-handlers.ts
function readContainerRef(reader) {
  const entityId = reader.optionalString("entity_id");
  const blockReader = reader.optionalObject("block");
  if (entityId !== void 0) return { entityId };
  if (blockReader !== void 0) {
    return {
      block: {
        dimension: blockReader.string("dimension"),
        location: blockReader.vector3("location")
      }
    };
  }
  throw CommandError.invalidInput("container must reference an entity_id or a block");
}
var spawnItem = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_item_spawn");
  const dimensionId = reader.string("dimension");
  const itemType = reader.string("item_type");
  const location = reader.vector3("location");
  const count = reader.optionalInteger("count");
  const properties = reader.optionalObject("properties");
  return ctx.scheduler.run(() => {
    const stack = buildItemStack(itemType, count, properties);
    const entity = resolveDimension(ctx.world, dimensionId).spawnItem(stack, location);
    return { entity: entitySummary(entity) };
  });
};
var getInventory = (payload, ctx) => {
  const reference = readContainerRef(
    PayloadReader.open(payload, "mc_inventory_get").object_("container")
  );
  return ctx.scheduler.run(() => ({
    inventory: containerSummary(requireContainer(ctx.world, reference))
  }));
};
var setSlot = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_inventory_set_slot");
  const reference = readContainerRef(reader.object_("container"));
  const slot = reader.integer("slot");
  const itemType = reader.string("item_type");
  const count = reader.optionalInteger("count");
  const properties = reader.optionalObject("properties");
  return ctx.scheduler.run(() => {
    const container = requireContainer(ctx.world, reference);
    if (slot < 0 || slot >= container.size) {
      throw CommandError.invalidInput(`slot ${slot} is out of range (0..${container.size - 1})`);
    }
    const stack = buildItemStack(itemType, count, properties);
    container.setItem(slot, stack);
    return { slot, item: itemStackSummary(stack) };
  });
};
var clearSlot = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_inventory_clear_slot");
  const reference = readContainerRef(reader.object_("container"));
  const slot = reader.integer("slot");
  return ctx.scheduler.run(() => {
    const container = requireContainer(ctx.world, reference);
    if (slot < 0 || slot >= container.size) {
      throw CommandError.invalidInput(`slot ${slot} is out of range (0..${container.size - 1})`);
    }
    container.setItem(slot, void 0);
    return { slot, cleared: true };
  });
};
var inventoryHandlers = {
  mc_item_spawn: spawnItem,
  mc_inventory_get: getInventory,
  mc_inventory_set_slot: setSlot,
  mc_inventory_clear_slot: clearSlot
};

// src/dispatcher/handlers/player-handlers.ts
import {
  GameMode
} from "@minecraft/server";
var GAME_MODES = ["survival", "creative", "adventure", "spectator"];
var WIRE_TO_GAME_MODE = {
  survival: GameMode.Survival,
  creative: GameMode.Creative,
  adventure: GameMode.Adventure,
  spectator: GameMode.Spectator
};
function readMessage(reader, key) {
  const value = reader.raw(key);
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw CommandError.invalidInput(`${key} must be a string or a rawtext object`);
}
function playerInventory(player) {
  const component = player.getComponent("minecraft:inventory");
  if (component?.container === void 0) {
    throw CommandError.behaviorPack(`player '${player.name}' has no inventory container`);
  }
  return component.container;
}
function quote(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
var listPlayers = (_payload, ctx) => ctx.scheduler.run(() => ({
  players: ctx.world.getAllPlayers().map((player) => ({
    name: player.name,
    id: player.id,
    location: vec(player.location),
    dimension: player.dimension.id,
    game_mode: player.getGameMode()
  }))
}));
var sendMessage = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_send_message");
  const name = reader.string("player");
  const message = readMessage(reader, "message");
  return ctx.scheduler.run(() => {
    requirePlayer(ctx.world, name).sendMessage(message);
    return { player: name };
  });
};
var sendTitle = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_send_title");
  const name = reader.string("player");
  const title = reader.string("title");
  const subtitle = reader.optionalString("subtitle");
  const options = reader.optionalObject("options");
  return ctx.scheduler.run(() => {
    const titleOptions = {
      subtitle,
      fadeInDuration: options?.optionalInteger("fade_in_ticks"),
      stayDuration: options?.optionalInteger("stay_ticks"),
      fadeOutDuration: options?.optionalInteger("fade_out_ticks")
    };
    requirePlayer(ctx.world, name).onScreenDisplay.setTitle(title, titleOptions);
    return { player: name };
  });
};
var sendActionbar = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_send_actionbar");
  const name = reader.string("player");
  const text = reader.string("text");
  return ctx.scheduler.run(() => {
    requirePlayer(ctx.world, name).onScreenDisplay.setActionBar(text);
    return { player: name };
  });
};
var setGamemode = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_set_gamemode");
  const name = reader.string("player");
  const mode = reader.enumValue("mode", GAME_MODES);
  return ctx.scheduler.run(() => {
    const gameMode = WIRE_TO_GAME_MODE[mode];
    if (gameMode === void 0) throw new Error(`unmapped game mode '${mode}'`);
    requirePlayer(ctx.world, name).setGameMode(gameMode);
    return { player: name, mode };
  });
};
var giveItem = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_give_item");
  const name = reader.string("player");
  const itemType = reader.string("item_type");
  const count = reader.optionalInteger("count");
  const properties = reader.optionalObject("properties");
  return ctx.scheduler.run(() => {
    const stack = buildItemStack(itemType, count, properties);
    const leftover = playerInventory(requirePlayer(ctx.world, name)).addItem(stack);
    return { player: name, item_type: itemType, fully_added: leftover === void 0 };
  });
};
var clearInventory = (payload, ctx) => {
  const name = PayloadReader.open(payload, "mc_player_clear_inventory").string("player");
  return ctx.scheduler.run(() => {
    playerInventory(requirePlayer(ctx.world, name)).clearAll();
    return { player: name };
  });
};
var getInventory2 = (payload, ctx) => {
  const name = PayloadReader.open(payload, "mc_player_get_inventory").string("player");
  return ctx.scheduler.run(() => ({
    player: name,
    inventory: containerSummary(playerInventory(requirePlayer(ctx.world, name)))
  }));
};
var setCamera = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_set_camera");
  const name = reader.string("player");
  const options = reader.object_("options");
  const location = options.optionalVector3("location");
  const facing = options.optionalVector3("facing_location");
  const rotationReader = options.optionalObject("rotation");
  const easeSeconds = options.optionalNumber("ease_seconds");
  const easeType = options.optionalString("ease_type");
  const preset = options.optionalString("preset") ?? (location !== void 0 || rotationReader !== void 0 ? "minecraft:free" : void 0);
  if (preset === void 0) {
    throw CommandError.invalidInput(
      "mc_player_set_camera requires options.preset, or a location/rotation"
    );
  }
  let command = `camera ${quote(name)} set ${preset}`;
  if (easeSeconds !== void 0) command += ` ease ${easeSeconds} ${easeType ?? "linear"}`;
  if (location !== void 0) command += ` pos ${location.x} ${location.y} ${location.z}`;
  if (rotationReader !== void 0) {
    command += ` rot ${rotationReader.number("x")} ${rotationReader.number("y")}`;
  }
  if (facing !== void 0) command += ` facing ${facing.x} ${facing.y} ${facing.z}`;
  return ctx.scheduler.run(() => {
    const result = requirePlayer(ctx.world, name).runCommand(command);
    return { player: name, preset, applied: result.successCount > 0 };
  });
};
var playSound = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_play_sound");
  const name = reader.string("player");
  const sound = reader.string("sound");
  const options = reader.optionalObject("options");
  const location = options?.optionalVector3("location");
  const volume = options?.optionalNumber("volume");
  const pitch = options?.optionalNumber("pitch");
  return ctx.scheduler.run(() => {
    requirePlayer(ctx.world, name).playSound(sound, { location, volume, pitch });
    return { player: name, sound };
  });
};
var kickPlayer = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_player_kick");
  const name = reader.string("player");
  const reason = reader.optionalString("reason");
  return ctx.scheduler.run(() => {
    const command = reason === void 0 ? `kick ${quote(name)}` : `kick ${quote(name)} ${reason}`;
    const result = ctx.world.getDimension("overworld").runCommand(command);
    return { player: name, kicked: result.successCount > 0 };
  });
};
var playerHandlers = {
  mc_player_list: listPlayers,
  mc_player_send_message: sendMessage,
  mc_player_send_title: sendTitle,
  mc_player_send_actionbar: sendActionbar,
  mc_player_set_gamemode: setGamemode,
  mc_player_give_item: giveItem,
  mc_player_clear_inventory: clearInventory,
  mc_player_get_inventory: getInventory2,
  mc_player_set_camera: setCamera,
  mc_player_play_sound: playSound,
  mc_player_kick: kickPlayer
};

// src/dispatcher/handlers/property-handlers.ts
function resolveTarget(world2, scope) {
  if (scope === "world") return world2;
  if (typeof scope === "object" && scope !== null) {
    const entityId = scope["entity_id"];
    if (typeof entityId === "string") return requireEntity(world2, entityId);
  }
  throw CommandError.invalidInput("scope must be 'world' or { entity_id }");
}
function readPropertyValue(reader) {
  const value = reader.raw("value");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object" && value !== null && typeof value["x"] === "number" && typeof value["y"] === "number" && typeof value["z"] === "number") {
    const vector = value;
    return { x: vector["x"], y: vector["y"], z: vector["z"] };
  }
  throw CommandError.invalidInput("value must be a string, number, boolean, or { x, y, z } vector");
}
var getProperty = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_property_get");
  const scope = reader.raw("scope");
  const name = reader.string("name");
  return ctx.scheduler.run(() => {
    const value = resolveTarget(ctx.world, scope).getDynamicProperty(name);
    return { name, value: value ?? null };
  });
};
var setProperty = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_property_set");
  const scope = reader.raw("scope");
  const name = reader.string("name");
  const value = readPropertyValue(reader);
  return ctx.scheduler.run(() => {
    resolveTarget(ctx.world, scope).setDynamicProperty(name, value);
    return { name, value };
  });
};
var listProperties = (payload, ctx) => {
  const scope = PayloadReader.open(payload, "mc_property_list").raw("scope");
  return ctx.scheduler.run(() => ({
    names: resolveTarget(ctx.world, scope).getDynamicPropertyIds()
  }));
};
var clearProperty = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_property_clear");
  const scope = reader.raw("scope");
  const name = reader.optionalString("name");
  return ctx.scheduler.run(() => {
    const target = resolveTarget(ctx.world, scope);
    if (name === void 0) {
      target.clearDynamicProperties();
      return { cleared: "all" };
    }
    target.setDynamicProperty(name, void 0);
    return { cleared: name };
  });
};
var propertyHandlers = {
  mc_property_get: getProperty,
  mc_property_set: setProperty,
  mc_property_list: listProperties,
  mc_property_clear: clearProperty
};

// src/dispatcher/handlers/scoreboard-handlers.ts
function requireObjective(scoreboard, id) {
  const objective = scoreboard.getObjective(id);
  if (objective === void 0) {
    throw CommandError.notFound(`no scoreboard objective '${id}'`);
  }
  return objective;
}
var listObjectives = (_payload, ctx) => ctx.scheduler.run(() => ({
  objectives: ctx.world.scoreboard.getObjectives().map((objective) => ({
    id: objective.id,
    display_name: objective.displayName
  }))
}));
var addObjective = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_add_objective");
  const id = reader.string("id");
  const displayName = reader.optionalString("display_name");
  const criteria = reader.optionalString("criteria");
  if (criteria !== void 0 && criteria !== "dummy") {
    throw CommandError.invalidInput("the Script API only supports the 'dummy' objective criteria");
  }
  return ctx.scheduler.run(() => {
    if (ctx.world.scoreboard.getObjective(id) !== void 0) {
      throw CommandError.invalidInput(`scoreboard objective '${id}' already exists`);
    }
    const objective = ctx.world.scoreboard.addObjective(id, displayName ?? id);
    return { id: objective.id, display_name: objective.displayName };
  });
};
var removeObjective = (payload, ctx) => {
  const id = PayloadReader.open(payload, "mc_scoreboard_remove_objective").string("id");
  return ctx.scheduler.run(() => {
    const removed = ctx.world.scoreboard.removeObjective(
      requireObjective(ctx.world.scoreboard, id)
    );
    return { id, removed };
  });
};
var getScore = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_get_score");
  const objectiveId = reader.string("objective");
  const participant = reader.string("participant");
  return ctx.scheduler.run(() => {
    const objective = requireObjective(ctx.world.scoreboard, objectiveId);
    const score = objective.getScore(participant);
    return { objective: objectiveId, participant, score: score ?? null };
  });
};
var setScore = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_set_score");
  const objectiveId = reader.string("objective");
  const participant = reader.string("participant");
  const score = reader.integer("score");
  return ctx.scheduler.run(() => {
    requireObjective(ctx.world.scoreboard, objectiveId).setScore(participant, score);
    return { objective: objectiveId, participant, score };
  });
};
var addScore = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_add_score");
  const objectiveId = reader.string("objective");
  const participant = reader.string("participant");
  const amount = reader.integer("amount");
  return ctx.scheduler.run(() => {
    const objective = requireObjective(ctx.world.scoreboard, objectiveId);
    const score = (objective.getScore(participant) ?? 0) + amount;
    objective.setScore(participant, score);
    return { objective: objectiveId, participant, score };
  });
};
var resetParticipant = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_scoreboard_reset_participant");
  const participant = reader.string("participant");
  const objectiveId = reader.optionalString("objective");
  return ctx.scheduler.run(() => {
    const objectives = objectiveId === void 0 ? ctx.world.scoreboard.getObjectives() : [requireObjective(ctx.world.scoreboard, objectiveId)];
    let reset = 0;
    for (const objective of objectives) {
      if (objective.removeParticipant(participant)) reset += 1;
    }
    return { participant, objectives_reset: reset };
  });
};
var scoreboardHandlers = {
  mc_scoreboard_list_objectives: listObjectives,
  mc_scoreboard_add_objective: addObjective,
  mc_scoreboard_remove_objective: removeObjective,
  mc_scoreboard_get_score: getScore,
  mc_scoreboard_set_score: setScore,
  mc_scoreboard_add_score: addScore,
  mc_scoreboard_reset_participant: resetParticipant
};

// src/dispatcher/handlers/server-handlers.ts
var STARTED_AT = Date.now();
var TPS_SAMPLE_MS = 1e3;
var TARGET_TPS = 20;
var reloadAddons = (_payload, ctx) => ctx.scheduler.run(() => {
  const result = ctx.world.getDimension("overworld").runCommand("reload");
  return { reloaded: result.successCount > 0 };
});
var saveWorld = async (_payload, ctx) => {
  const overworld = () => ctx.world.getDimension("overworld");
  await ctx.scheduler.run(() => overworld().runCommand("save hold"));
  await ctx.scheduler.delay(1e3);
  await ctx.scheduler.run(() => overworld().runCommand("save query"));
  await ctx.scheduler.delay(500);
  const resume = await ctx.scheduler.run(() => overworld().runCommand("save resume"));
  return { saved: resume.successCount > 0 };
};
var getStatus = async (_payload, ctx) => {
  const tickStart = ctx.scheduler.currentTick();
  const timeStart = Date.now();
  await ctx.scheduler.delay(TPS_SAMPLE_MS);
  const elapsedMs = Date.now() - timeStart;
  const ticksElapsed = ctx.scheduler.currentTick() - tickStart;
  const tps = elapsedMs > 0 ? Math.min(TARGET_TPS, ticksElapsed * 1e3 / elapsedMs) : TARGET_TPS;
  return ctx.scheduler.run(() => ({
    uptime_ms: Date.now() - STARTED_AT,
    online_players: ctx.world.getAllPlayers().length,
    current_tick: ctx.scheduler.currentTick(),
    tps: Math.round(tps * 100) / 100
  }));
};
var serverHandlers = {
  mc_server_reload_addons: reloadAddons,
  mc_server_save_world: saveWorld,
  mc_server_get_status: getStatus
};

// src/dispatcher/handlers/structure-handlers.ts
import {
  StructureAnimationMode,
  StructureMirrorAxis,
  StructureRotation,
  StructureSaveMode
} from "@minecraft/server";
var SAVE_MODES = ["memory", "world"];
var ROTATIONS = ["None", "Rotate90", "Rotate180", "Rotate270"];
var MIRRORS = ["None", "X", "Z", "XZ"];
var ANIMATIONS = ["None", "Layers", "Blocks"];
var SAVE_MODE = {
  memory: StructureSaveMode.Memory,
  world: StructureSaveMode.World
};
var ROTATION = {
  None: StructureRotation.None,
  Rotate90: StructureRotation.Rotate90,
  Rotate180: StructureRotation.Rotate180,
  Rotate270: StructureRotation.Rotate270
};
var MIRROR = {
  None: StructureMirrorAxis.None,
  X: StructureMirrorAxis.X,
  Z: StructureMirrorAxis.Z,
  XZ: StructureMirrorAxis.XZ
};
var ANIMATION = {
  None: StructureAnimationMode.None,
  Layers: StructureAnimationMode.Layers,
  Blocks: StructureAnimationMode.Blocks
};
function optionalSaveMode(reader) {
  const value = reader?.optionalEnum("save_mode", SAVE_MODES);
  return value === void 0 ? void 0 : SAVE_MODE[value];
}
var listStructures = (_payload, ctx) => {
  ctx.capabilities.requireFeature("structure.list");
  return ctx.scheduler.run(() => ({ ids: ctx.world.structureManager.getWorldStructureIds() }));
};
var getStructure = (payload, ctx) => {
  const id = PayloadReader.open(payload, "mc_structure_get").string("id");
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.get(id);
    if (structure === void 0) throw CommandError.notFound(`no structure '${id}'`);
    return { id: structure.id, size: vec(structure.size) };
  });
};
var createEmpty = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_create_empty");
  const id = reader.string("id");
  const size = reader.vector3("size");
  const saveMode = reader.optionalEnum("save_mode", SAVE_MODES);
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.createEmpty(
      id,
      size,
      saveMode === void 0 ? void 0 : SAVE_MODE[saveMode]
    );
    return { id: structure.id, size: vec(structure.size) };
  });
};
var createFromWorld = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_create_from_world");
  const id = reader.string("id");
  const dimensionId = reader.string("dimension");
  const from = reader.vector3("from");
  const to = reader.vector3("to");
  const options = reader.optionalObject("options");
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.createFromWorld(
      id,
      resolveDimension(ctx.world, dimensionId),
      from,
      to,
      {
        saveMode: optionalSaveMode(options),
        includeBlocks: options?.optionalBoolean("include_blocks"),
        includeEntities: options?.optionalBoolean("include_entities")
      }
    );
    return { id: structure.id, size: vec(structure.size) };
  });
};
var placeStructure = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_place");
  const id = reader.string("id");
  const dimensionId = reader.string("dimension");
  const location = reader.vector3("location");
  const options = reader.optionalObject("options");
  const rotation = options?.optionalEnum("rotation", ROTATIONS);
  const mirror = options?.optionalEnum("mirror", MIRRORS);
  const animation = options?.optionalEnum("animation_mode", ANIMATIONS);
  const integrity = options?.optionalNumber("integrity");
  const includeEntities = options?.optionalBoolean("include_entities");
  const animationSeconds = options?.optionalNumber("animation_seconds");
  return ctx.scheduler.run(() => {
    ctx.world.structureManager.place(id, resolveDimension(ctx.world, dimensionId), location, {
      rotation: rotation === void 0 ? void 0 : ROTATION[rotation],
      mirror: mirror === void 0 ? void 0 : MIRROR[mirror],
      animationMode: animation === void 0 ? void 0 : ANIMATION[animation],
      integrity,
      includeEntities,
      animationSeconds
    });
    return { id, location: vec(location) };
  });
};
var deleteStructure = (payload, ctx) => {
  const id = PayloadReader.open(payload, "mc_structure_delete").string("id");
  return ctx.scheduler.run(() => ({ id, deleted: ctx.world.structureManager.delete(id) }));
};
var setStructureBlock = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_structure_set_block");
  const id = reader.string("id");
  const location = reader.vector3("location");
  const blockType = reader.string("block_type");
  const states = reader.optionalRecord("states");
  return ctx.scheduler.run(() => {
    const structure = ctx.world.structureManager.get(id);
    if (structure === void 0) throw CommandError.notFound(`no structure '${id}'`);
    structure.setBlockPermutation(location, buildBlockPermutation(blockType, states));
    return { id, location: vec(location), block_type: blockType };
  });
};
var structureHandlers = {
  mc_structure_list: listStructures,
  mc_structure_get: getStructure,
  mc_structure_create_empty: createEmpty,
  mc_structure_create_from_world: createFromWorld,
  mc_structure_place: placeStructure,
  mc_structure_delete: deleteStructure,
  mc_structure_set_block: setStructureBlock
};

// src/dispatcher/handlers/world-handlers.ts
import { MolangVariableMap, WeatherType } from "@minecraft/server";
var WEATHER_TYPES = ["Clear", "Rain", "Thunder"];
var WIRE_TO_WEATHER = {
  Clear: WeatherType.Clear,
  Rain: WeatherType.Rain,
  Thunder: WeatherType.Thunder
};
function readMessage2(reader, key) {
  const value = reader.raw(key);
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw CommandError.invalidInput(`${key} must be a string or a rawtext object`);
}
var getInfo = (_payload, ctx) => ctx.scheduler.run(() => ({
  // The Script API exposes neither the world name nor the Minecraft version.
  name: null,
  minecraft_version: null,
  day: ctx.world.getDay(),
  time_of_day: ctx.world.getTimeOfDay(),
  current_tick: ctx.scheduler.currentTick(),
  player_count: ctx.world.getAllPlayers().length,
  dimensions: [...DIMENSION_IDS]
}));
var getTime = (_payload, ctx) => ctx.scheduler.run(() => ({
  time_of_day: ctx.world.getTimeOfDay(),
  absolute_time: ctx.world.getAbsoluteTime(),
  day: ctx.world.getDay()
}));
var getWeather = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_get_weather");
  const dimensionId = reader.string("dimension");
  return ctx.scheduler.run(() => ({
    dimension: dimensionId,
    weather: resolveDimension(ctx.world, dimensionId).getWeather()
  }));
};
var getDimensions = () => Promise.resolve({ dimensions: [...DIMENSION_IDS] });
var getDimensionInfo = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_get_dimension_info");
  const dimensionId = reader.string("dimension");
  return ctx.scheduler.run(() => {
    const dimension = resolveDimension(ctx.world, dimensionId);
    return { id: dimension.id, height_range: dimension.heightRange };
  });
};
var setTime = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_set_time");
  const value = reader.integer("value");
  return ctx.scheduler.run(() => {
    ctx.world.setTimeOfDay(value);
    return { time_of_day: value };
  });
};
var setWeather = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_set_weather");
  const dimensionId = reader.string("dimension");
  const type = reader.enumValue("type", WEATHER_TYPES);
  const duration = reader.optionalInteger("duration");
  return ctx.scheduler.run(() => {
    const weather = WIRE_TO_WEATHER[type];
    if (weather === void 0) throw new Error(`unmapped weather type '${type}'`);
    resolveDimension(ctx.world, dimensionId).setWeather(weather, duration);
    return { dimension: dimensionId, type };
  });
};
var sendMessage2 = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_send_message");
  const target = reader.string("target");
  const message = readMessage2(reader, "message");
  return ctx.scheduler.run(() => {
    if (target === "all") {
      ctx.world.sendMessage(message);
      return { delivered_to: "all" };
    }
    const player = ctx.world.getAllPlayers().find((candidate) => candidate.name === target);
    if (player === void 0) {
      return { delivered_to: target, online: false };
    }
    player.sendMessage(message);
    return { delivered_to: target, online: true };
  });
};
var playSound2 = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_play_sound");
  const dimensionId = reader.string("dimension");
  const sound = reader.string("sound");
  const location = reader.vector3("location");
  const options = reader.optionalObject("options");
  const volume = options?.optionalNumber("volume");
  const pitch = options?.optionalNumber("pitch");
  return ctx.scheduler.run(() => {
    resolveDimension(ctx.world, dimensionId).playSound(sound, location, { volume, pitch });
    return { sound, location: vec(location) };
  });
};
var spawnParticle = (payload, ctx) => {
  const reader = PayloadReader.open(payload, "mc_world_spawn_particle");
  const dimensionId = reader.string("dimension");
  const name = reader.string("name");
  const location = reader.vector3("location");
  const molang = reader.optionalRecord("molang_variables");
  return ctx.scheduler.run(() => {
    let variables2;
    if (molang !== void 0) {
      variables2 = new MolangVariableMap();
      for (const [key, value] of Object.entries(molang)) {
        if (typeof value !== "number") {
          throw new Error(`molang variable '${key}' must be a number`);
        }
        variables2.setFloat(key, value);
      }
    }
    resolveDimension(ctx.world, dimensionId).spawnParticle(name, location, variables2);
    return { name, location: vec(location) };
  });
};
var worldHandlers = {
  mc_world_get_info: getInfo,
  mc_world_get_time: getTime,
  mc_world_get_weather: getWeather,
  mc_world_get_dimensions: getDimensions,
  mc_world_get_dimension_info: getDimensionInfo,
  mc_world_set_time: setTime,
  mc_world_set_weather: setWeather,
  mc_world_send_message: sendMessage2,
  mc_world_play_sound: playSound2,
  mc_world_spawn_particle: spawnParticle
};

// src/dispatcher/handlers/index.ts
var EXPECTED_HANDLER_COUNT = 71;
function buildHandlerRegistry() {
  const registry = {
    ...worldHandlers,
    ...blockHandlers,
    ...structureHandlers,
    ...entityHandlers,
    ...playerHandlers,
    ...inventoryHandlers,
    ...scoreboardHandlers,
    ...propertyHandlers,
    ...effectHandlers,
    ...eventHandlers,
    ...commandHandlers,
    ...serverHandlers
  };
  const count = Object.keys(registry).length;
  if (count !== EXPECTED_HANDLER_COUNT) {
    throw new Error(
      `handler registry has ${count} kinds, expected ${EXPECTED_HANDLER_COUNT} \u2014 a domain table likely has a duplicate or missing key`
    );
  }
  return Object.freeze({ ...registry });
}

// src/event-publisher.ts
var SOFT_BATCH_SIZE = 64;
var ACCUMULATION_WINDOW_MS = 100;
var BUFFER_CAP = 2048;
function createEventPublisher(deps) {
  const { transport, scheduler, logger } = deps;
  const backoff = createBackoff();
  let buffer = [];
  let draining = false;
  let windowScheduled = false;
  let dropped = 0;
  async function drain() {
    draining = true;
    try {
      while (buffer.length > 0) {
        const batch = buffer.slice(0, EVENT_BATCH_MAX);
        const report = { events: batch };
        try {
          await transport.reportEvents(report);
          buffer = buffer.slice(batch.length);
          backoff.reset();
        } catch (error) {
          const delayMs = backoff.nextDelayMs();
          logger.warn("event delivery failed; will retry", {
            buffered: buffer.length,
            failures: backoff.failureCount,
            delayMs,
            reason: error instanceof Error ? error.message : String(error)
          });
          await scheduler.delay(delayMs);
        }
      }
    } finally {
      draining = false;
    }
  }
  function startDrain() {
    if (draining) return;
    void drain();
  }
  return {
    enqueue(event) {
      if (buffer.length >= BUFFER_CAP) {
        buffer.shift();
        dropped += 1;
        if (dropped % 256 === 1) {
          logger.warn("event buffer at capacity; dropping oldest events", { dropped });
        }
      }
      buffer.push(event);
      if (buffer.length >= SOFT_BATCH_SIZE) {
        startDrain();
        return;
      }
      if (!windowScheduled && !draining) {
        windowScheduled = true;
        void scheduler.delay(ACCUMULATION_WINDOW_MS).then(() => {
          windowScheduled = false;
          startDrain();
        });
      }
    }
  };
}

// src/result-reporter.ts
var BUFFER_CAP2 = 512;
function createResultReporter(deps) {
  const { transport, scheduler, logger } = deps;
  const backoff = createBackoff();
  const buffer = [];
  let draining = false;
  async function drain() {
    draining = true;
    try {
      while (buffer.length > 0) {
        const next = buffer[0];
        if (next === void 0) break;
        try {
          await transport.reportResult(next);
          buffer.shift();
          backoff.reset();
        } catch (error) {
          const delayMs = backoff.nextDelayMs();
          logger.warn("result delivery failed; will retry", {
            commandId: next.id,
            buffered: buffer.length,
            failures: backoff.failureCount,
            delayMs,
            reason: error instanceof Error ? error.message : String(error)
          });
          await scheduler.delay(delayMs);
        }
      }
    } finally {
      draining = false;
    }
  }
  return {
    report(result) {
      if (buffer.length >= BUFFER_CAP2) {
        const dropped = buffer.shift();
        logger.warn("result buffer at capacity; dropping oldest result", {
          droppedCommandId: dropped?.id
        });
      }
      buffer.push(result);
      if (!draining) void drain();
    }
  };
}

// src/runtime/job-scheduler.ts
var TICKS_PER_SECOND = 20;
function createJobScheduler(system2) {
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        system2.run(() => {
          try {
            resolve(task());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    },
    runJob(task) {
      return new Promise((resolve, reject) => {
        function* driver() {
          try {
            resolve(yield* task());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
        system2.runJob(driver());
      });
    },
    delay(ms) {
      const ticks = Math.max(1, Math.ceil(ms / 1e3 * TICKS_PER_SECOND));
      return new Promise((resolve) => {
        system2.runTimeout(resolve, ticks);
      });
    },
    currentTick() {
      return system2.currentTick;
    }
  };
}

// src/runtime/logger.ts
var LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};
function formatContext(context) {
  if (context === void 0) return "";
  try {
    return ` ${JSON.stringify(context)}`;
  } catch {
    return " [uninspectable context]";
  }
}
var SINKS = {
  error: (line) => console.error(line),
  warn: (line) => console.warn(line),
  info: (line) => console.info(line),
  debug: (line) => console.log(line)
};
function createLogger(threshold, scope = "bedrock-bridge") {
  function emit(level, message, context) {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[threshold]) return;
    const line = `[${scope}] ${level.toUpperCase()} ${message}${formatContext(context)}`;
    SINKS[level](line);
  }
  return {
    error: (message, context) => emit("error", message, context),
    warn: (message, context) => emit("warn", message, context),
    info: (message, context) => emit("info", message, context),
    debug: (message, context) => emit("debug", message, context),
    child: (childScope) => createLogger(threshold, `${scope}:${childScope}`)
  };
}

// src/subscriptions/event-bindings.ts
function vec2(v) {
  return { x: v.x, y: v.y, z: v.z };
}
function entityRef(entity) {
  return { id: entity.id, type_id: entity.typeId, location: vec2(entity.location) };
}
function playerRef(player) {
  return { id: player.id, name: player.name, location: vec2(player.location) };
}
function blockRef(block) {
  return { type_id: block.typeId, location: vec2(block.location) };
}
function defineBinding(eventType, mode, select, project) {
  return {
    eventType,
    mode,
    subscribe(world2, emit) {
      const signal = select(world2);
      const listener = (event) => {
        emit(project(event));
      };
      signal.subscribe(listener);
      return () => {
        signal.unsubscribe(listener);
      };
    }
  };
}
var BINDINGS = [
  defineBinding(
    "playerJoin",
    "after",
    (world2) => world2.afterEvents.playerJoin,
    (event) => ({ player_id: event.playerId, player_name: event.playerName })
  ),
  defineBinding(
    "playerLeave",
    "after",
    (world2) => world2.afterEvents.playerLeave,
    (event) => ({ player_id: event.playerId, player_name: event.playerName })
  ),
  defineBinding(
    "playerSpawn",
    "after",
    (world2) => world2.afterEvents.playerSpawn,
    (event) => ({ player: playerRef(event.player), initial_spawn: event.initialSpawn })
  ),
  defineBinding(
    "playerBreakBlock",
    "after",
    (world2) => world2.afterEvents.playerBreakBlock,
    (event) => ({
      player: playerRef(event.player),
      block: blockRef(event.block),
      broken_block_type: event.brokenBlockPermutation.type.id
    })
  ),
  defineBinding(
    "playerPlaceBlock",
    "after",
    (world2) => world2.afterEvents.playerPlaceBlock,
    (event) => ({ player: playerRef(event.player), block: blockRef(event.block) })
  ),
  defineBinding(
    "entitySpawn",
    "after",
    (world2) => world2.afterEvents.entitySpawn,
    (event) => ({ entity: entityRef(event.entity), cause: event.cause })
  ),
  defineBinding(
    "entityDie",
    "after",
    (world2) => world2.afterEvents.entityDie,
    (event) => ({
      dead_entity: entityRef(event.deadEntity),
      cause: event.damageSource.cause,
      damaging_entity: event.damageSource.damagingEntity === void 0 ? null : entityRef(event.damageSource.damagingEntity)
    })
  ),
  defineBinding(
    "entityHurt",
    "after",
    (world2) => world2.afterEvents.entityHurt,
    (event) => ({
      hurt_entity: entityRef(event.hurtEntity),
      damage: event.damage,
      cause: event.damageSource.cause,
      damaging_entity: event.damageSource.damagingEntity === void 0 ? null : entityRef(event.damageSource.damagingEntity)
    })
  ),
  defineBinding(
    "effectAdd",
    "after",
    (world2) => world2.afterEvents.effectAdd,
    (event) => ({
      entity: entityRef(event.entity),
      effect: {
        type_id: event.effect.typeId,
        duration: event.effect.duration,
        amplifier: event.effect.amplifier
      }
    })
  ),
  defineBinding(
    "explosion",
    "after",
    (world2) => world2.afterEvents.explosion,
    (event) => ({
      dimension: event.dimension.id,
      source: event.source === void 0 ? null : entityRef(event.source)
    })
  ),
  defineBinding(
    "weatherChange",
    "after",
    (world2) => world2.afterEvents.weatherChange,
    (event) => ({
      dimension: event.dimension,
      new_weather: event.newWeather,
      previous_weather: event.previousWeather
    })
  ),
  defineBinding(
    "buttonPush",
    "after",
    (world2) => world2.afterEvents.buttonPush,
    (event) => ({
      block: blockRef(event.block),
      source: event.source === void 0 ? null : entityRef(event.source)
    })
  ),
  defineBinding(
    "leverAction",
    "after",
    (world2) => world2.afterEvents.leverAction,
    (event) => ({
      block: blockRef(event.block),
      is_powered: event.isPowered,
      player: event.player === void 0 ? null : playerRef(event.player)
    })
  ),
  defineBinding(
    "pressurePlatePush",
    "after",
    (world2) => world2.afterEvents.pressurePlatePush,
    (event) => ({
      block: blockRef(event.block),
      source: event.source === void 0 ? null : entityRef(event.source)
    })
  ),
  defineBinding(
    "itemUse",
    "after",
    (world2) => world2.afterEvents.itemUse,
    (event) => ({
      source: playerRef(event.source),
      item_type: event.itemStack?.typeId ?? null
    })
  ),
  defineBinding(
    "chatSend",
    "before",
    (world2) => world2.beforeEvents.chatSend,
    (event) => ({ sender: playerRef(event.sender), message: event.message })
  )
];
var REGISTRY = new Map(
  BINDINGS.map((binding) => [binding.eventType, binding])
);
function getEventBinding(eventType) {
  return REGISTRY.get(eventType);
}

// src/subscriptions/subscription-manager.ts
function deepEquals(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObject = a;
    const bObject = b;
    const keys = Object.keys(aObject);
    if (keys.length !== Object.keys(bObject).length) return false;
    return keys.every((key) => deepEquals(aObject[key], bObject[key]));
  }
  return false;
}
function matchesFilter2(payload, filter) {
  if (filter === void 0 || filter === null) return true;
  if (typeof filter !== "object" || Array.isArray(filter)) return true;
  if (typeof payload !== "object" || payload === null) return false;
  const payloadObject = payload;
  return Object.entries(filter).every(
    ([key, value]) => deepEquals(payloadObject[key], value)
  );
}
function createSubscriptionManager(deps) {
  const { world: world2, events, logger } = deps;
  const armed = /* @__PURE__ */ new Map();
  return {
    arm(subscriptionId, eventType, filter) {
      if (armed.has(subscriptionId)) {
        logger.debug("subscription already armed; ignoring", { subscriptionId, eventType });
        return;
      }
      const binding = getEventBinding(eventType);
      if (binding === void 0) {
        throw CommandError.unsupported(`no event binding for event type '${eventType}'`);
      }
      const unsubscribe2 = binding.subscribe(world2, (payload) => {
        if (!armed.has(subscriptionId)) return;
        if (!matchesFilter2(payload, filter)) return;
        const event = {
          subscription_id: subscriptionId,
          event_type: eventType,
          occurred_at: (/* @__PURE__ */ new Date()).toISOString(),
          payload
        };
        events.enqueue(event);
      });
      armed.set(subscriptionId, { eventType, unsubscribe: unsubscribe2 });
      logger.info("subscription armed", { subscriptionId, eventType, mode: binding.mode });
    },
    disarm(subscriptionId) {
      const subscription = armed.get(subscriptionId);
      if (subscription === void 0) return false;
      armed.delete(subscriptionId);
      try {
        subscription.unsubscribe();
      } catch (error) {
        logger.warn("error while unsubscribing a Script API listener", {
          subscriptionId,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
      logger.info("subscription disarmed", { subscriptionId });
      return true;
    },
    has(subscriptionId) {
      return armed.has(subscriptionId);
    },
    list() {
      return [...armed.entries()].map(([id, subscription]) => ({
        id,
        eventType: subscription.eventType
      }));
    }
  };
}

// src/transport/http-transport.ts
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";
var POLL_TIMEOUT_MARGIN_SECONDS = 10;
var SHORT_TIMEOUT_SECONDS = 15;
var DEFAULT_POLL_TIMEOUT_MS = 3e4;
function createHttpTransport(config) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  let pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS;
  function buildRequest(method, path, timeoutSeconds, body) {
    const request = new HttpRequest(`${baseUrl}${path}`);
    request.method = method;
    request.timeout = timeoutSeconds;
    request.headers = [
      // The token is an opaque SecretString resolved into the header at send
      // time; it already carries the `Bearer ` scheme (see config.readToken).
      new HttpHeader("Authorization", config.token),
      new HttpHeader("Accept", "application/json"),
      ...body === void 0 ? [] : [new HttpHeader("Content-Type", "application/json")]
    ];
    if (body !== void 0) request.body = JSON.stringify(body);
    return request;
  }
  async function send(method, path, timeoutSeconds, body) {
    try {
      const response = await http.request(buildRequest(method, path, timeoutSeconds, body));
      return { status: response.status, body: response.body };
    } catch (error) {
      throw new TransportError(`network failure on ${method} ${path}`, { cause: error });
    }
  }
  function parseJson(body, path) {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new TransportError(`malformed JSON in ${path} response`, { cause: error });
    }
  }
  return {
    setPollTimeoutMs(value) {
      pollTimeoutMs = value;
    },
    async handshake(request) {
      const { status, body } = await send(
        HttpRequestMethod.Post,
        "/bridge/handshake",
        SHORT_TIMEOUT_SECONDS,
        request
      );
      if (status !== 200 && status !== 409) {
        throw new TransportError(`handshake rejected with HTTP ${status}`, { status });
      }
      try {
        return decodeHandshakeResponse(parseJson(body, "/bridge/handshake"));
      } catch (error) {
        if (error instanceof ProtocolDecodeError) {
          throw new TransportError(error.message, { status, cause: error });
        }
        throw error;
      }
    },
    async poll() {
      const timeoutSeconds = Math.ceil(pollTimeoutMs / 1e3) + POLL_TIMEOUT_MARGIN_SECONDS;
      const { status, body } = await send(HttpRequestMethod.Get, "/bridge/poll", timeoutSeconds);
      if (status !== 200) {
        throw new TransportError(`poll failed with HTTP ${status}`, { status });
      }
      try {
        return decodePollResponse(parseJson(body, "/bridge/poll"));
      } catch (error) {
        if (error instanceof ProtocolDecodeError) {
          throw new TransportError(error.message, { status, cause: error });
        }
        throw error;
      }
    },
    async reportResult(result) {
      const { status } = await send(
        HttpRequestMethod.Post,
        "/bridge/result",
        SHORT_TIMEOUT_SECONDS,
        result
      );
      if (status < 200 || status >= 300) {
        throw new TransportError(`result rejected with HTTP ${status}`, { status });
      }
    },
    async reportEvents(report) {
      const { status } = await send(
        HttpRequestMethod.Post,
        "/bridge/event",
        SHORT_TIMEOUT_SECONDS,
        report
      );
      if (status < 200 || status >= 300) {
        throw new TransportError(`event report rejected with HTTP ${status}`, { status });
      }
    }
  };
}

// src/world-identity.ts
var WORLD_ID_PROPERTY = "bedrock_bridge:world_id";
var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomToken(length) {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return token;
}
function resolveWorldId(world2) {
  const existing = world2.getDynamicProperty(WORLD_ID_PROPERTY);
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  const generated = `world_${randomToken(26)}`;
  world2.setDynamicProperty(WORLD_ID_PROPERTY, generated);
  return generated;
}

// src/index.ts
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const reason = error instanceof ConfigError ? error.message : String(error);
    createLogger("error").error("configuration error \u2014 the bridge will not start", { reason });
    return;
  }
  const logger = createLogger(config.logLevel);
  const scheduler = createJobScheduler(system);
  const capabilities = probeCapabilities(world, logger.child("capabilities"));
  const transport = createHttpTransport({ baseUrl: config.baseUrl, token: config.token });
  const eventPublisher = createEventPublisher({
    transport,
    scheduler,
    logger: logger.child("events")
  });
  const subscriptions = createSubscriptionManager({
    world,
    events: eventPublisher,
    logger: logger.child("subscriptions")
  });
  const resultReporter = createResultReporter({
    transport,
    scheduler,
    logger: logger.child("results")
  });
  const services = {
    world,
    scheduler,
    subscriptions,
    events: eventPublisher,
    capabilities,
    logger: logger.child("handler")
  };
  const dispatcher = createDispatcher(buildHandlerRegistry(), services);
  const commandPump = createCommandPump({
    dispatcher,
    resultReporter,
    logger: logger.child("pump")
  });
  const worldId = await scheduler.run(() => resolveWorldId(world));
  const handshakeRequest = {
    protocol_version: PROTOCOL_VERSION,
    behavior_pack_version: BEHAVIOR_PACK_VERSION,
    script_modules: capabilities.scriptModules,
    world_id: worldId
  };
  const client = createBridgeClient({
    transport,
    commandPump,
    scheduler,
    logger: logger.child("bridge"),
    handshakeRequest,
    onHandshakeAccepted: async (accepted) => {
      for (const subscription of accepted.resync_subscriptions) {
        await scheduler.run(() => {
          try {
            subscriptions.arm(
              subscription.subscription_id,
              subscription.event_type,
              subscription.filter
            );
          } catch (error) {
            logger.warn("could not re-arm a resynced subscription", {
              subscriptionId: subscription.subscription_id,
              eventType: subscription.event_type,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        });
      }
    }
  });
  logger.info("Bedrock Bridge behavior pack starting", {
    worldId,
    baseUrl: config.baseUrl,
    protocolVersion: PROTOCOL_VERSION,
    behaviorPackVersion: BEHAVIOR_PACK_VERSION,
    commandKinds: dispatcher.kinds.length
  });
  await client.run();
  logger.info("Bedrock Bridge behavior pack stopped");
}
system.run(() => {
  void main();
});
