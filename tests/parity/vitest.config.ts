import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@web": fileURLToPath(new URL("../../web/src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/parity/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
