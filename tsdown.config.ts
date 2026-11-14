import { defineConfig, type UserConfig } from "tsdown";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

const lib = (entry: Record<string, string>, external: string[] = []): UserConfig => ({
  entry,
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: true,
  clean: false,
  deps: { neverBundle: external },
  outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
  dts: { generator: "oxc", tsconfig: "tsconfig.dts.json", sourcemap: false },
});

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: "esm",
    platform: "node",
    target: "node22",
    fixedExtension: true,
    clean: true,
    dts: false,
    banner: {
      js: '#!/usr/bin/env node\nimport{createRequire as __cr}from"node:module";globalThis.require=__cr(import.meta.url);',
    },
    deps: { alwaysBundle: [/.*/] },
    minify: true,
    treeshake: true,
    define: { __KNARR_VERSION__: JSON.stringify(version) },
    outputOptions: { keepNames: true, comments: { legal: false } },
  },
  lib({ index: "src/index.ts" }),
  lib({ "vite-plugin": "src/vite-plugin.ts" }, ["vite"]),
  lib({ "webpack-plugin": "src/webpack-plugin.ts" }, ["webpack", "@rspack/core"]),
]);
