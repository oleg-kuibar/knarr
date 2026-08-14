import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PackageManager } from "../../types.js";
import type { PackageInstallLayout } from "../package-manager.js";
import { inspectProjectPackageManager } from "../package-manager.js";

describe("inspectProjectPackageManager", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "KNARR-package-manager-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it.each([
    {
      packageManager: "npm",
      files: [["package-lock.json", ""]],
      layout: "node-modules",
      command: "npm install -D knarr",
    },
    {
      packageManager: "pnpm",
      files: [["pnpm-lock.yaml", ""]],
      layout: "pnpm",
      command: "pnpm add -D knarr",
    },
    {
      packageManager: "yarn",
      files: [
        ["yarn.lock", ""],
        [".yarnrc.yml", "nodeLinker: node-modules\n"],
      ],
      layout: "node-modules",
      command: "yarn add -D knarr",
    },
    {
      packageManager: "bun",
      files: [["bun.lock", ""]],
      layout: "bun",
      command: "bun add -d knarr",
    },
  ] satisfies Array<{
    packageManager: PackageManager;
    files: string[][];
    layout: PackageInstallLayout;
    command: string;
  }>)(
    "keeps $packageManager detection, layout, and commands in one adapter",
    async ({ packageManager, files, layout, command }) => {
      await Promise.all(
        files.map(([name, content]) =>
          writeFile(join(projectDir, name), content)
        )
      );

      const resolved = (
        await inspectProjectPackageManager(projectDir)
      ).resolve();

      expect(resolved).toMatchObject({
        packageManager,
        layout,
        nodeModulesCompatible: true,
      });
      expect(
        resolved.formatCommand(
          resolved.installCommand(["knarr"], { dev: true })
        )
      ).toBe(command);
    }
  );

  it("resolves Yarn Berry compatibility and diagnostics together", async () => {
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.6.0" })
    );

    const project = await inspectProjectPackageManager(projectDir);
    const resolved = project.resolve();

    expect(resolved).toMatchObject({
      packageManager: "yarn",
      layout: "node-modules",
      nodeModulesCompatible: false,
    });
    expect(resolved.incompatibilityReason).toContain("Yarn PnP");
    expect(resolved.yarnLinkerDiagnostic).toMatchObject({
      status: "fail",
      message: expect.stringContaining("defaults to PnP"),
    });
    expect(
      resolved.formatCommand(resolved.installCommand(["knarr"], { dev: true }))
    ).toBe("yarn add -D knarr");
  });

  it("uses one tracked fallback for both layout and commands", async () => {
    const project = await inspectProjectPackageManager(projectDir);
    const resolved = project.resolve("pnpm");

    expect(resolved).toMatchObject({
      packageManager: "pnpm",
      layout: "pnpm",
      nodeModulesCompatible: true,
    });
    expect(
      resolved.formatCommand(resolved.installCommand(["react"]))
    ).toBe("pnpm add react");
  });

  it("prefers explicit project evidence over tracked package-manager state", async () => {
    await writeFile(join(projectDir, "package-lock.json"), "{}");

    const project = await inspectProjectPackageManager(projectDir);

    expect(project.resolve("yarn")).toMatchObject({
      packageManager: "npm",
      layout: "node-modules",
      nodeModulesCompatible: true,
    });
  });

  it("treats an explicit PnP manifest as incompatible", async () => {
    await writeFile(join(projectDir, ".pnp.cjs"), "");

    const resolved = (
      await inspectProjectPackageManager(projectDir)
    ).resolve();

    expect(resolved).toMatchObject({
      packageManager: "yarn",
      nodeModulesCompatible: false,
      yarnLinkerDiagnostic: {
        status: "fail",
        message: expect.stringContaining("not compatible"),
      },
    });
  });

  it("resolves the Yarn pnpm adapter and its configured store", async () => {
    await writeFile(join(projectDir, "yarn.lock"), "");
    await writeFile(
      join(projectDir, ".yarnrc.yml"),
      "nodeLinker: pnpm\npnpmStoreFolder: .cache/yarn-store\n"
    );

    const resolved = (
      await inspectProjectPackageManager(projectDir)
    ).resolve();

    expect(resolved).toMatchObject({
      packageManager: "yarn",
      layout: "yarn-pnpm",
      nodeModulesCompatible: true,
      virtualStoreFolder: ".cache/yarn-store",
    });
  });

  it("rejects unsafe or empty dependency lists", async () => {
    const resolved = (
      await inspectProjectPackageManager(projectDir)
    ).resolve();

    expect(() =>
      resolved.installCommand(["left-pad && rm -rf /"])
    ).toThrow("Invalid package name");
    expect(() => resolved.installCommand([])).toThrow("No dependencies provided");
  });
});
