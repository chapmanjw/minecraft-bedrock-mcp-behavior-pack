// Test mock for `@minecraft/server-admin`. Configuration loading is not
// exercised by unit tests; this stub exists so the vitest alias resolves.

export const variables = {
  names: [] as string[],
  get(): unknown {
    return undefined;
  },
};

export const secrets = {
  names: [] as string[],
  get(): string | undefined {
    return undefined;
  },
};
