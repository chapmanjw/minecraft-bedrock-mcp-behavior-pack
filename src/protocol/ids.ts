/**
 * Identifier patterns shared by the bridge protocol.
 *
 * Both a command id and a subscription id are a fixed prefix followed by a
 * 26-character Crockford base32 ULID.
 */

/** Pattern for a command identifier: `cmd_` followed by a 26-char ULID. */
export const COMMAND_ID_PATTERN = /^cmd_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Pattern for a subscription identifier: `sub_` followed by a 26-char ULID. */
export const SUBSCRIPTION_ID_PATTERN = /^sub_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Whether a string is a well-formed command id. */
export function isCommandId(value: string): boolean {
  return COMMAND_ID_PATTERN.test(value);
}

/** Whether a string is a well-formed subscription id. */
export function isSubscriptionId(value: string): boolean {
  return SUBSCRIPTION_ID_PATTERN.test(value);
}
