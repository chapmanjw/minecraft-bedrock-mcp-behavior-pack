# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack/security/advisories/new)
rather than a public issue. You will receive an acknowledgement within a few days.

## Security model

- **Bearer token.** Every request to the bridge carries the `bridge_agent_token` as a bearer
  token. It is loaded from the `@minecraft/server-admin` secrets store (`secrets.json`), never
  hardcoded, and never committed — `secrets.json` is git-ignored, and only
  `secrets.json.example` is tracked.
- **Token redaction.** The logger redacts the token from every line it writes, so it cannot reach
  the BDS content log even if it is accidentally included in a message.
- **Transport.** The pack connects to whatever `bridge_url` specifies. Run the MCP server and the
  behavior pack on the same host, or use TLS (`https://`) and a trusted network — the bridge
  carries world-mutating commands.
- **Capability scope.** `permissions.json` grants the pack exactly three Script API modules and
  nothing more.

## Scope

This behavior pack executes world-mutating commands on a Minecraft server on behalf of the MCP
server it connects to. Treat the bridge token as a credential that grants full control of the
world, and deploy the pack only against an MCP server and network you trust.
