import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 30000,
    coverage: {
      thresholds: {
        lines: 70,
      },
    },
    benchmark: {
      include: ["**/*.bench.ts"],
      outputJson: "bench-results.json",
    },
  },
});
