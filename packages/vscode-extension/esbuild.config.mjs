import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

/** Extension host bundle (Node/CJS) */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: true,
  target: "node22",
};

/** Webview bundle (browser/IIFE) */
const webviewConfig = {
  entryPoints: ["src/graph/webview/graph.ts"],
  bundle: true,
  outfile: "dist/webview/graph.js",
  format: "iife",
  platform: "browser",
  sourcemap: true,
  target: "es2022",
};

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const webCtx = await esbuild.context(webviewConfig);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
}
