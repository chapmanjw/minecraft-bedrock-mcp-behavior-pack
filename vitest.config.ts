import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The Script API modules are provided by BDS at runtime and externalized by the
 * bundler. Tests run in Node, so they resolve against hand-written mocks that
 * mirror the vendored ambient declarations in `types/`.
 */
const mock = (name: string) => fileURLToPath(new URL(`./tests/mocks/${name}.ts`, import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/generated/**"],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@minecraft/server-admin": mock("minecraft-server-admin"),
      "@minecraft/server-net": mock("minecraft-server-net"),
      "@minecraft/server": mock("minecraft-server"),
    },
  },
});
