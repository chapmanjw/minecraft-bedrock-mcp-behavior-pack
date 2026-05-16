// Vendored ambient declarations for the `@minecraft/server-admin` Script API.
//
// `@minecraft/server-admin` exposes the dedicated-server `variables.json` and
// `secrets.json` configuration files to the behavior pack. It is a beta module
// and requires the "Beta APIs" experiment enabled on the world.
// See https://learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server-admin/

declare module "@minecraft/server-admin" {
  /** Non-sensitive configuration values, from the server's `variables.json`. */
  export class ServerVariables {
    readonly names: string[];
    get(name: string): unknown;
  }

  /** Sensitive configuration values, from the server's `secrets.json`. */
  export class ServerSecrets {
    readonly names: string[];
    get(name: string): string | undefined;
  }

  export const variables: ServerVariables;
  export const secrets: ServerSecrets;
}
