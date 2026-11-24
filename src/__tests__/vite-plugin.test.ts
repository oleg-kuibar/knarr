import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { UserConfig } from "vite";
import knarrPlugin from "../vite-plugin.js";

let root: string;

async function writePackage(dir: string, manifest: object, files: string[] = []): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  for (const file of files) {
    await mkdir(join(dir, file, ".."), { recursive: true });
    await writeFile(join(dir, file), "");
  }
}

function runConfigHook(config: UserConfig = {}): UserConfig | undefined {
  const plugin = knarrPlugin();
  const hook = plugin.config as (config: UserConfig, env: { command: string; mode: string }) => UserConfig | undefined;
  return hook({ root, ...config }, { command: "serve", mode: "development" });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "KNARR-vite-plugin-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  await mkdir(join(root, ".knarr"), { recursive: true });
  await writeFile(
    join(root, ".knarr", "state.json"),
    JSON.stringify({ links: { "@scope/lib": {}, "other-linked": {} } })
  );
  const nm = join(root, "node_modules");
  await writePackage(join(nm, "@scope/lib"), {
    name: "@scope/lib",
    version: "1.0.0",
    dependencies: {
      "cjs-dep": "1",
      "nested-dep": "1",
      "exports-dep": "1",
      "css-only": "1",
      "css-exports": "1",
      "types-only": "1",
      "missing-dep": "1",
      "other-linked": "1",
      "../escape": "1",
    },
  });
  await writePackage(join(nm, "@scope/lib/node_modules/nested-dep"), { name: "nested-dep", main: "lib/index" }, ["lib/index.js"]);
  await writePackage(join(nm, "cjs-dep"), { name: "cjs-dep" }, ["index.js"]);
  await writePackage(join(nm, "exports-dep"), { name: "exports-dep", exports: { ".": { import: "./esm.mjs" }, "./package.json": "./package.json" } }, ["esm.mjs"]);
  await writePackage(join(nm, "css-only"), { name: "css-only", main: "index.css" }, ["index.css"]);
  await writePackage(join(nm, "css-exports"), { name: "css-exports", exports: { "./styles.css": "./styles.css" } }, ["styles.css"]);
  await writePackage(join(nm, "types-only"), { name: "types-only", types: "index.d.ts" }, ["index.d.ts"]);
  await writePackage(join(nm, "other-linked"), { name: "other-linked" }, ["index.js"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("knarr vite plugin optimizeDeps", () => {
  it("pre-bundles JavaScript dependencies of linked packages and skips CSS-only, types-only, missing and linked ones", () => {
    const result = runConfigHook();
    expect(result?.optimizeDeps?.exclude).toEqual(["@scope/lib", "other-linked"]);
    expect([...(result?.optimizeDeps?.include ?? [])].sort()).toEqual([
      "@scope/lib > cjs-dep",
      "@scope/lib > exports-dep",
      "@scope/lib > nested-dep",
    ]);
  });

  it("does not repeat entries the user already includes", () => {
    const result = runConfigHook({ optimizeDeps: { include: ["@scope/lib > cjs-dep"] } });
    expect(result?.optimizeDeps?.include).not.toContain("@scope/lib > cjs-dep");
  });
});
