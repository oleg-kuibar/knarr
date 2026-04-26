import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Exclude Knarr-linked packages so Vite doesn't pre-bundle them.
    // This ensures changes are picked up when knarr pushes new files.
    exclude: ["@example/api-client"],
  },
});
