import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    clean: true,
    splitting: true,
    target: "node22",
    banner: {
      js: '#!/usr/bin/env node\nimport{createRequire as __cr}from"node:module";globalThis.require=__cr(import.meta.url);',
    },
    noExternal: [/.*/],
    minify: true,
    treeshake: true,
    define: {
      __KNARR_VERSION__: JSON.stringify(version),
    },
    esbuildOptions(options) {
      options.keepNames = true;
      options.legalComments = "none";
      options.drop = ["debugger"];
    },
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    dts: true,
    splitting: false,
    target: "node22",
  },
  {
    entry: { "vite-plugin": "src/vite-plugin.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    dts: true,
    splitting: false,
    target: "node22",
    external: ["vite"],
  },
  {
    entry: { "webpack-plugin": "src/webpack-plugin.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    dts: true,
    splitting: false,
    target: "node22",
    external: ["webpack", "@rspack/core"],
  },
]);
