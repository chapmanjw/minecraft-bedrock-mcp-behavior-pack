/**
 * The bridge protocol — the wire contract between the behavior pack and the
 * MCP server.
 *
 * This module is a self-contained leaf: it depends on nothing else in `src/`,
 * mirroring `protocol/` in the MCP server repository so the two can one day be
 * extracted into a shared package. The server's copy validates with `zod`; this
 * copy hand-rolls the equivalent in `validation.ts` to keep the BDS bundle free
 * of third-party runtime dependencies.
 */
export * from "./protocol-version";
export * from "./ids";
export * from "./command";
export * from "./result";
export * from "./event";
export * from "./handshake";
export * from "./validation";
