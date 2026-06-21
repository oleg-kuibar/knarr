import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWatchConfig, runInitialWatchBuild } from "../core/push-engine.js";

describe("resolveWatchConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-watch-config-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("preserves configured watch patterns when a build command exists", async () => {
    const config = await resolveWatchConfig(
      tempDir,
      {},
      {
        buildCmd: "pnpm build",
        watchPatterns: ["schema", "package.json"],
      }
    );

    expect(config.buildCmd).toBe("pnpm build");
    expect(config.patterns).toEqual(["schema", "package.json"]);
  });

  it("runs the auto-detected initial watch build before first push", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        packageManager: "npm@10.9.0",
        scripts: { build: "node scripts/build.cjs" },
      })
    );
    await mkdir(join(tempDir, "scripts"));
    await writeFile(
      join(tempDir, "scripts", "build.cjs"),
      [
        "const { mkdirSync, writeFileSync } = require('node:fs');",
        "mkdirSync('dist', { recursive: true });",
        "writeFileSync('dist/built.txt', 'fresh build');",
      ].join("\n")
    );

    await expect(runInitialWatchBuild(tempDir, {})).resolves.toBe(true);

    await expect(readFile(join(tempDir, "dist", "built.txt"), "utf-8"))
      .resolves.toBe("fresh build");
  });

  it("returns false when the initial watch build fails", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "pkg", version: "1.0.0" })
    );
    await writeFile(join(tempDir, "fail.cjs"), "process.exit(7);\n");

    await expect(
      runInitialWatchBuild(tempDir, { build: "node fail.cjs" })
    ).resolves.toBe(false);
  });
});
