import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectBuildCommand } from "../build-detect.js";
import type { PackageManager } from "../../types.js";

describe("detectBuildCommand", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-build-detect-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it.each([
    ["npm", "npm run build"],
    ["pnpm", "pnpm build"],
    ["yarn", "yarn build"],
    ["bun", "bun run build"],
  ] satisfies [PackageManager, string][])(
    "returns the package-manager script command for %s",
    async (pm, expected) => {
      await writePackageJson({ scripts: { build: "tsup" } });

      await expect(detectBuildCommand(tempDir, pm)).resolves.toBe(expected);
    }
  );

  it("uses the first known build-like script", async () => {
    await writePackageJson({ scripts: { compile: "tsc", bundle: "rollup -c" } });

    await expect(detectBuildCommand(tempDir, "pnpm")).resolves.toBe("pnpm compile");
  });

  it("returns null when no build-like script exists", async () => {
    await writePackageJson({ scripts: { test: "vitest" } });

    await expect(detectBuildCommand(tempDir, "npm")).resolves.toBeNull();
  });

  async function writePackageJson(pkg: unknown): Promise<void> {
    await writeFile(join(tempDir, "package.json"), JSON.stringify(pkg));
  }
});
