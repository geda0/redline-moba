import { defineConfig } from "vitest/config";

// The simulation (src/sim) is pure and headless — it tests without a browser.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
