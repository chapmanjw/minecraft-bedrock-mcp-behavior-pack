# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-05-18

Pairs with [`minecraft-bedrock-mcp-server`](https://github.com/chapmanjw/minecraft-bedrock-mcp-server)
v0.3.0 — install both together.

### Added

- `mc_structure_create_from_blocks` command handler — builds a saved structure from a
  run-length-encoded block grid. It calls `createEmpty` (world-saved by default) and then
  `setBlockPermutation` for each non-void cell inside a `runJob` that yields under the
  script watchdog, so the result is immediately placeable and persists across reloads.

### Removed

- `mc_server_reload_world` command handler. The structure-upload feature it supported now
  builds structures in the world directly and needs no `/reload all`.

## [0.2.0] - 2026-05-18

Pairs with [`minecraft-bedrock-mcp-server`](https://github.com/chapmanjw/minecraft-bedrock-mcp-server)
v0.2.0 — install both together.

### Added

- `mc_server_reload_world` command handler — runs `/reload all` to re-index uploaded
  `.mcstructure` files and rejoin online players. It reports its result first and issues the
  command a moment later, since `/reload all` reloads the pack's own script context, and fails
  with a clear error when no player is online to anchor the reload. Brings the command surface
  to 72 handlers.

## [0.1.0] - 2026-05-16

### Added

- Bridge protocol module — hand-written types and runtime decoders for the command, result,
  event, and handshake envelopes, mirroring the MCP server's `protocol/` module with no
  third-party runtime dependency, plus an independently versioned `PROTOCOL_VERSION`.
- Poll-loop state machine — handshake negotiation, continuous long-polling, a decoupled command
  pump, and reconnection with jittered backoff that re-handshakes on a lost session.
- HTTP transport over `@minecraft/server-net`, behind a `BridgeTransport` interface so the poll
  loop is testable without the Script API.
- Job scheduler — the single gateway to the Script API execution context, wrapping `system.run`
  and `system.runJob` so block sweeps yield under the watchdog.
- The full 71-handler command surface — world, blocks, structures, entities, players, inventory,
  scoreboard, dynamic properties, effects, event subscriptions, the raw-command escape hatch, and
  server administration.
- Subscription manager and event publisher — on-demand Script API event listeners, projected to
  JSON and batched to the bridge with size/time flushing and bounded back-pressure.
- Result reporter — buffered, retried delivery of every command result.
- Capability probe reporting Script API module versions at handshake.
- Vendored `@minecraft/server*` type declarations, an `esbuild` bundle to `scripts/main.js`, and
  a CI workflow.

[Unreleased]: https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack/releases/tag/v0.1.0
