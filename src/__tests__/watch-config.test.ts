import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWatchConfig } from "../core/push-engine.js";

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
});
