import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPackageManager, detectYarnNodeLinker, hasYarnrcYml } from "../pm-detect.js";

describe("detectPackageManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(join(tempDir, "package-lock.json"), "{}");
    expect(await detectPackageManager(tempDir)).toBe("npm");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(tempDir)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(tempDir, "yarn.lock"), "");
    expect(await detectPackageManager(tempDir)).toBe("yarn");
  });

  it("detects bun from bun.lockb", async () => {
    await writeFile(join(tempDir, "bun.lockb"), "");
    expect(await detectPackageManager(tempDir)).toBe("bun");
  });

  it("defaults to npm when no lockfile", async () => {
    expect(await detectPackageManager(tempDir)).toBe("npm");
  });

  it("prefers pnpm over npm when both exist", async () => {
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    await writeFile(join(tempDir, "package-lock.json"), "{}");
    expect(await detectPackageManager(tempDir)).toBe("pnpm");
  });

  it("walks up to find lockfile in parent (monorepo)", async () => {
    const nested = join(tempDir, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(nested)).toBe("pnpm");
  });

  it("closest lockfile wins over parent", async () => {
    const nested = join(tempDir, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    await writeFile(join(nested, "package-lock.json"), "{}");
    expect(await detectPackageManager(nested)).toBe("npm");
  });
});

describe("detectYarnNodeLinker", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns 'pnpm' when nodeLinker is pnpm", async () => {
    await writeFile(join(tempDir, ".yarnrc.yml"), "nodeLinker: pnpm\n");
    expect(await detectYarnNodeLinker(tempDir)).toBe("pnpm");
  });

  it("returns 'node-modules' when nodeLinker is node-modules", async () => {
    await writeFile(join(tempDir, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    expect(await detectYarnNodeLinker(tempDir)).toBe("node-modules");
  });

  it("returns 'pnp' when nodeLinker is pnp", async () => {
    await writeFile(join(tempDir, ".yarnrc.yml"), "nodeLinker: pnp\n");
    expect(await detectYarnNodeLinker(tempDir)).toBe("pnp");
  });

  it("returns null when .yarnrc.yml is missing", async () => {
    expect(await detectYarnNodeLinker(tempDir)).toBeNull();
  });

  it("returns null when .yarnrc.yml has no nodeLinker key", async () => {
    await writeFile(join(tempDir, ".yarnrc.yml"), "yarnPath: .yarn/releases/yarn-4.0.0.cjs\n");
    expect(await detectYarnNodeLinker(tempDir)).toBeNull();
  });

  it("handles comments and extra whitespace", async () => {
    const content = [
      "# Some comment",
      "  ",
      "yarnPath: .yarn/releases/yarn-4.0.0.cjs",
      "# nodeLinker: pnp",
      "nodeLinker:   pnpm  ",
      "",
    ].join("\n");
    await writeFile(join(tempDir, ".yarnrc.yml"), content);
    expect(await detectYarnNodeLinker(tempDir)).toBe("pnpm");
  });

  it("handles quoted values", async () => {
    await writeFile(join(tempDir, ".yarnrc.yml"), 'nodeLinker: "node-modules"\n');
    expect(await detectYarnNodeLinker(tempDir)).toBe("node-modules");
  });

  it("walks up to find .yarnrc.yml in parent", async () => {
    const nested = join(tempDir, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(tempDir, ".yarnrc.yml"), "nodeLinker: pnpm\n");
    expect(await detectYarnNodeLinker(nested)).toBe("pnpm");
  });
});

describe("hasYarnrcYml", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns true when .yarnrc.yml exists", async () => {
    await writeFile(join(tempDir, ".yarnrc.yml"), "");
    expect(await hasYarnrcYml(tempDir)).toBe(true);
  });

  it("returns false when .yarnrc.yml is missing", async () => {
    expect(await hasYarnrcYml(tempDir)).toBe(false);
  });

  it("walks up to find .yarnrc.yml in parent", async () => {
    const nested = join(tempDir, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(tempDir, ".yarnrc.yml"), "");
    expect(await hasYarnrcYml(nested)).toBe(true);
  });
});
