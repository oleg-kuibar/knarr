import { defineConfig } from "tsdown";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
    "vite-plugin": "src/vite-plugin.ts",
    "webpack-plugin": "src/webpack-plugin.ts",
  },
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: true,
  clean: true,
  deps: { alwaysBundle: [/.*/], neverBundle: ["vite", "webpack", "@rspack/core"] },
  outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
  dts: { generator: "oxc", tsconfig: "tsconfig.dts.json", sourcemap: false },
  minify: true,
  treeshake: true,
  define: { __KNARR_VERSION__: JSON.stringify(version) },
  outputOptions: {
    comments: { legal: false },
    banner: (chunk) => (chunk.name === "cli" && chunk.isEntry ? "#!/usr/bin/env node" : ""),
  },
  publint: { level: "suggestion", strict: true },
  attw: { profile: "esm-only", level: "error" },
});
