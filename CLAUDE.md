# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install          # install dev deps (no runtime deps — Script API is provided by BDS)
npm run typecheck    # strict TypeScript (no emit)
npm run lint         # ESLint with type-checked rules
npm run format:check # Prettier check
npm run format       # Prettier write
npm test             # vitest (run once)
npm run test:watch   # vitest (watch mode)
npm run build        # bundles src/ → scripts/main.js via esbuild
```

Run a single test file: `npx vitest run tests/bridge-client.test.ts`

**`scripts/main.js` is a committed build artifact.** Always run `npm run build` after changing `src/`. CI verifies it is in sync.

## Architecture

This pack is the in-world half of a three-tier system:

```
MCP client (Claude, Cursor…)
  │ MCP over Streamable HTTP
minecraft-bedrock-mcp-server       ← separate repo
  │ HTTP long-poll + bearer token  (/bridge/* routes)
this behavior pack                 ← this repo
  │ @minecraft/server Script API
Minecraft Bedrock world
```

### Startup sequence (`src/index.ts`)

`system.run` defers `main()` so the first Script API calls happen in a privileged tick. `main()` constructs all services, builds the handler registry, then calls `client.run()` — which blocks forever (or until the bridge refuses the handshake).

### Poll-loop state machine (`src/bridge-client.ts`)

Two states: **Handshaking** and **Polling**. The loop re-handshakes on 401/403/409 or after 6 consecutive poll failures. A refused handshake (incompatible major protocol version) is terminal — the loop exits. Transport failures back off with jitter and never abandon the bridge.

The poll loop never waits on command execution. Commands are handed to the `CommandPump` and the loop polls again immediately.

### Command pump (`src/command-pump.ts`)

Decouples poll reception from execution. Commands run **serially** (Script API mutations are observable across ticks; serial execution keeps watchdog pressure predictable). Commands past their `deadline_ms` are skipped and reported as errors — the server discards late results.

### Dispatcher (`src/dispatcher/dispatcher.ts`)

Routes `command.kind` (= the MCP tool name, e.g. `mc_block_set`) to the handler registered for that key. Unknown kinds return `UNSUPPORTED_CAPABILITY`. The dispatcher never rejects — all handler exceptions are caught and mapped to error results.

### Handler registry (`src/dispatcher/handlers/index.ts`)

72 handlers across 12 domain files. The registry is assembled once at startup and asserted to contain exactly 72 keys — a duplicate or missing key throws immediately. To add a handler: add the `kind → handler` entry in the appropriate domain file and update `EXPECTED_HANDLER_COUNT`.

Domain files: `world`, `block`, `structure`, `entity`, `player`, `inventory`, `scoreboard`, `property`, `effect`, `event`, `command`, `server`.

### Handler contract (`src/dispatcher/command-handler.ts`)

Every handler is `(payload: unknown, context: HandlerContext) => Promise<unknown>`. Handlers never touch `system`, transport, or the network directly — all side effects go through named services on `HandlerContext`:

- `world` — Script API world singleton
- `scheduler` — the only gateway to privileged Script API execution contexts
- `subscriptions` — arm/disarm event listeners
- `events` — buffer world events for delivery to the bridge
- `capabilities` — negotiated Script API capability flags
- `logger` — scoped logger

### Job scheduler (`src/runtime/job-scheduler.ts`)

Wraps `system.run`, `system.runJob`, and `system.runTimeout`. Continuations after `await` (e.g., after an HTTP poll) run in restricted contexts where world mutation is illegal — **every Script API touch must go through `scheduler.run()`**. Long sweeps (filling thousands of blocks) use `scheduler.runJob()` to yield between ticks and stay under the watchdog.

### Transport (`src/transport/http-transport.ts`)

Wraps the four `/bridge/*` exchanges: `POST /bridge/handshake`, `GET /bridge/poll`, `POST /bridge/result`, `POST /bridge/event`. The token is an opaque `SecretString` from `@minecraft/server-admin` — the script never reads it; it is resolved into the `Authorization` header at send time. The `Bearer ` prefix is stored as part of the secret (see `config/default/secrets.json.example`).

### Subscriptions (`src/subscriptions/subscription-manager.ts`)

Script API subscriptions don't survive a script reload. The manager holds no persistent state; the MCP server replays the active set through `resync_subscriptions` on every handshake acceptance, and `index.ts` re-arms each one.

### Types directory (`types/`)

Vendored TypeScript declarations for `@minecraft/server`, `@minecraft/server-net`, and `@minecraft/server-admin`. These modules are provided by BDS at runtime and are not on npm. The vendored types make the build reproducible and independent of the Script API beta release channel. Update them when targeting a new BDS/Script API version.

## Key constraints

- **Beta APIs**: `@minecraft/server-net` and `@minecraft/server-admin` are Mojang beta modules. A BDS update can remove or change them. Keep BDS version, pack version, and MCP server version in lockstep.
- **`allow-cheats: true`** must be set in `server.properties` — `mc_run_command` and many command-backed handlers require it.
- **Beta APIs experiment**: The world must have the Beta APIs experiment enabled. This flag is set at world-creation time in the Minecraft client and cannot be toggled by BDS.
- **Protocol version**: The pack implements bridge protocol `1.0.0`. The major version is negotiated at handshake; a mismatch is terminal.
