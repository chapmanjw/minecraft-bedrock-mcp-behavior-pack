/**
 * Resolves a stable identifier for the world the behavior pack runs in.
 *
 * The Script API exposes no world UUID, so the pack generates one on first run
 * and persists it as a world dynamic property. The identifier then survives
 * both script reloads and full BDS restarts, which is what the bridge needs to
 * correlate a world across handshakes.
 */
import type { World } from "@minecraft/server";

/** Dynamic property key holding the generated world identifier. */
const WORLD_ID_PROPERTY = "bedrock_bridge:world_id";

/** Crockford-style base32 alphabet — unambiguous, case-insensitive. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomToken(length: number): string {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return token;
}

/**
 * Returns the world's stable identifier, generating and persisting one the
 * first time. Must be called in a Script API write context.
 */
export function resolveWorldId(world: World): string {
  const existing = world.getDynamicProperty(WORLD_ID_PROPERTY);
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  const generated = `world_${randomToken(26)}`;
  world.setDynamicProperty(WORLD_ID_PROPERTY, generated);
  return generated;
}
