# Bedrock Bridge Behavior Pack for Minecraft Bedrock MCP Server

A Minecraft **Bedrock Dedicated Server** (BDS) behavior pack that bridges a live world to the
[`minecraft-bedrock-mcp-server`](https://github.com/chapmanjw/minecraft-bedrock-mcp-server). It is
the in-game half of that system: it long-polls the bridge for commands, executes them through the
Bedrock Script API, and reports results and subscribed world events back.

> **New here?** This repository covers only the behavior pack — installing it, configuring it, and
> building it. For the **full end-to-end setup** — standing up a Bedrock Dedicated Server, creating
> a compatible world, installing the MCP server, and connecting Claude Desktop — start with the
> [`minecraft-bedrock-mcp-server` README](https://github.com/chapmanjw/minecraft-bedrock-mcp-server#readme).
> Prefer to be walked through it? The
> [`minecraft-bedrock-claude-plugin`](https://github.com/chapmanjw/minecraft-bedrock-claude-plugin)
> turns that setup into a guided experience inside Claude Code and adds agents for building in the
> world.

## ⚠️ The Bedrock Script API is experimental

This pack is built on Mojang's Bedrock **Script API**, and two of its three modules —
`@minecraft/server-net` and `@minecraft/server-admin` — are explicitly **beta**. The Script API as
a whole is an evolving surface that Mojang revises between Minecraft versions. **A Bedrock update
can change, deprecate, or remove APIs this pack depends on**, and beta modules can be discontinued
entirely with no stable replacement.

Treat this as experimental software:

- Pin your BDS to a known-good version; do not auto-update the server.
- Expect to rebuild the pack against new module versions when you do upgrade.
- Keep the BDS version, this pack's version, and the MCP server's version in lockstep.

## How it works

```
MCP clients (Claude, Cursor, ...)
   |  MCP over Streamable HTTP
minecraft-bedrock-mcp-server          <-- separate repository
   |  HTTP long-poll + bearer token   (the /bridge surface)
Bedrock Bridge behavior pack          <-- this repository
   |  @minecraft/server, @minecraft/server-net, @minecraft/server-admin
the Minecraft world
```

An MCP tool call enqueues a command on the server. This behavior pack polls `GET /bridge/poll`,
dispatches each command to a handler keyed by its `kind` (the originating tool name), executes it
through the Script API, and posts a result to `POST /bridge/result`. Subscribed world events are
batched to `POST /bridge/event`.

The pack:

1. Handshakes with the bridge on startup to negotiate the protocol version and re-arm any event
   subscriptions that did not survive a script reload.
2. Long-polls for commands continuously, reconnecting with jittered backoff on any failure.
3. Executes each command and reports a result for every one — success or failure.
4. Subscribes to Script API events on demand and batches them to the bridge.

## Requirements

- A Minecraft **Bedrock Dedicated Server**, 1.21.0 or newer.
- The companion **[`minecraft-bedrock-mcp-server`](https://github.com/chapmanjw/minecraft-bedrock-mcp-server)**,
  running on the same host.
- A world with the **Beta APIs** experiment enabled — `@minecraft/server-net` and
  `@minecraft/server-admin` are beta modules. See the MCP server README for how to create one.

## Install

Download the latest `bedrock-bridge.mcpack` from the
[Releases](https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack/releases) page, or
build it yourself (see [Development](#development)). The pack is the folder containing
`manifest.json`, the bundled `scripts/main.js`, and `pack_icon.png`; an `.mcpack` is simply that
folder zipped.

### Activate the pack on a world

1. Place the pack folder at `<world>/behavior_packs/bedrock-bridge/`.
2. Add the pack's **header UUID** and version to the world's `world_behavior_packs.json`:

   ```json
   [{ "pack_id": "fa013817-66f2-4a5f-a724-1347f912bd40", "version": [0, 2, 0] }]
   ```

3. Ensure the world has the **Beta APIs** experiment enabled. This toggle is set when the world is
   created in the Minecraft client and travels with the world — the dedicated server cannot enable
   it. See the MCP server README's tutorial for the world-creation steps.

The MCP server is pointed at this same folder through its `BRIDGE_BEHAVIOR_PACK_PATH` variable.

### `server.properties`

| Setting        | Value  | Why                                                        |
| -------------- | ------ | ---------------------------------------------------------- |
| `allow-cheats` | `true` | Required for `mc_run_command` and command-backed handlers. |

## Configuration

The pack reads its configuration through the `@minecraft/server-admin` configuration system. The
files live in the BDS scripting config directory — `<bds>/config/default/` applies to every pack,
and `<bds>/config/<module-uuid>/` targets only this one. This repository ships ready-to-copy files
under [`config/default/`](config/default/).

### `permissions.json`

Allows the pack to load its three Script API modules. Copy
[`config/default/permissions.json`](config/default/permissions.json) as-is:

```json
{
  "allowed_modules": ["@minecraft/server", "@minecraft/server-net", "@minecraft/server-admin"]
}
```

### `variables.json` — the bridge URL

A non-sensitive value. Copy [`config/default/variables.json`](config/default/variables.json) and
set `bridge_url` to where the MCP server's `/bridge` surface listens:

```json
{ "bridge_url": "http://localhost:8765" }
```

An optional `bridge_log_level` (`error`, `warn`, `info`, `debug`; default `info`) tunes verbosity.

### `secrets.json` — the bridge token

The bridge credential must **never** be committed. Copy
[`config/default/secrets.json.example`](config/default/secrets.json.example) to `secrets.json` in
the same directory and set `bridge_agent_token` to the **full `Authorization` header value** — the
word `Bearer`, a space, then the `BRIDGE_AGENT_TOKEN` configured on the MCP server:

```json
{ "bridge_agent_token": "Bearer the-token-from-the-mcp-server" }
```

`secrets.get` returns an opaque `SecretString`: its value is never exposed to the script and is
resolved only inside the `Authorization` header at request time. Because the script can neither
read nor concatenate it, the `Bearer ` scheme prefix must be stored as part of the secret.

## Bridge protocol

This pack implements bridge protocol version **`1.0.0`**. The protocol's major version is
negotiated at the handshake; if the MCP server speaks an incompatible major version it refuses the
connection, and the pack logs the reason and does not start its poll loop.

## Command surface

The pack implements **72 command handlers**, grouped by domain — world, blocks, structures,
entities, players, inventory, scoreboard, dynamic properties, effects, event subscriptions, the
raw-command escape hatch, and server administration. Each `kind` is the name of the MCP tool that
originated it (e.g. `mc_block_set`). The seven `mc_structure_file_*`, `mc_structure_upload`,
`mc_event_poll`, and `mc_event_list_subscriptions` tools run on the MCP server itself and never
reach the pack.

## Development

```sh
npm install
npm run typecheck   # strict TypeScript
npm run lint        # ESLint, type-checked rules
npm run format:check
npm test            # vitest
npm run build       # bundles src/ into scripts/main.js
```

`scripts/main.js` is a committed build artifact — releases ship it, and CI verifies it is in sync
with `src/`. Run `npm run build` after changing any source file.

The Script API modules are provided by BDS at runtime; the bundler marks them external. Their
TypeScript declarations are vendored under [`types/`](types/) so the build is reproducible and
independent of the Script API beta release channel.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [SECURITY.md](SECURITY.md) for the
security model.

## License

MIT — see [LICENSE](LICENSE).
