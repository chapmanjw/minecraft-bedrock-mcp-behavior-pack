// Vendored ambient declarations for the `@minecraft/server-admin` Script API.
//
// `@minecraft/server-admin` exposes the dedicated-server `variables.json` and
// `secrets.json` configuration files to the behavior pack. It is a beta module
// and requires the "Beta APIs" experiment enabled on the world.
// See https://learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server-admin/

declare module "@minecraft/server-admin" {
  /**
   * An opaque handle to a secret configured in `secrets.json`. The secret's
   * value is never exposed to the script environment — it is resolved only at
   * request time inside objects such as `HttpHeader`. A `SecretString` can be
   * passed around but cannot be read or concatenated by script.
   */
  export class SecretString {
    private constructor();
  }

  /** Non-sensitive configuration values, from the server's `variables.json`. */
  export class ServerVariables {
    readonly names: string[];
    get(name: string): unknown;
  }

  /** Sensitive configuration values, from the server's `secrets.json`. */
  export class ServerSecrets {
    readonly names: string[];
    /** Returns an opaque placeholder for the named secret, or `undefined`. */
    get(name: string): SecretString | undefined;
  }

  export const variables: ServerVariables;
  export const secrets: ServerSecrets;
}
