import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { resolveBinEntries, createBinLinks, removeBinLinks } from "../bin-linker.js";
import { exists } from "../fs.js";
import type { PackageJson } from "../../types.js";

describe("resolveBinEntries", () => {
  it("returns empty object when no bin field", () => {
    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    expect(resolveBinEntries(pkg)).toEqual({});
  });

  it("resolves string bin field to package name", () => {
    const pkg: PackageJson = {
      name: "my-cli",
      version: "1.0.0",
      bin: "./dist/cli.js",
    };
    expect(resolveBinEntries(pkg)).toEqual({ "my-cli": "./dist/cli.js" });
  });

  it("strips scope from string bin name", () => {
    const pkg: PackageJson = {
      name: "@scope/my-tool",
      version: "1.0.0",
      bin: "./dist/cli.js",
    };
    expect(resolveBinEntries(pkg)).toEqual({ "my-tool": "./dist/cli.js" });
  });

  it("passes through object bin field as-is", () => {
    const pkg: PackageJson = {
      name: "multi-bin",
      version: "1.0.0",
      bin: {
        "cmd-a": "./dist/a.js",
        "cmd-b": "./dist/b.js",
      },
    };
    const result = resolveBinEntries(pkg);
    expect(result).toEqual({
      "cmd-a": "./dist/a.js",
      "cmd-b": "./dist/b.js",
    });
  });
});

describe("createBinLinks and removeBinLinks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-bin-"));
    // Set up node_modules/my-cli/dist structure
    await mkdir(join(tempDir, "node_modules", "my-cli", "dist"), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, "node_modules", "my-cli", "dist", "cli.js"),
      '#!/usr/bin/env node\nconsole.log("hello");'
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates bin entries in node_modules/.bin/", async () => {
    const pkg: PackageJson = {
      name: "my-cli",
      version: "1.0.0",
      bin: { "my-cli": "dist/cli.js" },
    };

    const count = await createBinLinks(tempDir, "my-cli", pkg);
    expect(count).toBe(1);

    const binDir = join(tempDir, "node_modules", ".bin");
    expect(await exists(binDir)).toBe(true);

    if (platform() === "win32") {
      // Windows: should have .cmd file
      expect(await exists(join(binDir, "my-cli.cmd"))).toBe(true);
      const cmd = await readFile(join(binDir, "my-cli.cmd"), "utf-8");
      expect(cmd).toContain("ECHO off");
      expect(cmd).toContain('node "%dp0%\\..\\my-cli\\dist\\cli.js" %*');
      // Also should have shell script for Git Bash
      expect(await exists(join(binDir, "my-cli"))).toBe(true);
    } else {
      // Unix: should have symlink
      expect(await exists(join(binDir, "my-cli"))).toBe(true);
    }
  });

  it("returns 0 when no bin field", async () => {
    const pkg: PackageJson = { name: "no-bin", version: "1.0.0" };
    const count = await createBinLinks(tempDir, "no-bin", pkg);
    expect(count).toBe(0);
  });

  it("creates multiple bin links", async () => {
    await mkdir(join(tempDir, "node_modules", "multi", "dist"), {
      recursive: true,
    });
    await writeFile(join(tempDir, "node_modules", "multi", "dist", "a.js"), "");
    await writeFile(join(tempDir, "node_modules", "multi", "dist", "b.js"), "");

    const pkg: PackageJson = {
      name: "multi",
      version: "1.0.0",
      bin: { "cmd-a": "dist/a.js", "cmd-b": "dist/b.js" },
    };

    const count = await createBinLinks(tempDir, "multi", pkg);
    expect(count).toBe(2);
  });

  it("skips bin entries that escape the package directory", async () => {
    const pkg: PackageJson = {
      name: "my-cli",
      version: "1.0.0",
      bin: { "evil": "../../etc/passwd" },
    };

    const count = await createBinLinks(tempDir, "my-cli", pkg);
    expect(count).toBe(0);
  });

  it("removeBinLinks cleans up created links", async () => {
    const pkg: PackageJson = {
      name: "my-cli",
      version: "1.0.0",
      bin: { "my-cli": "dist/cli.js" },
    };

    await createBinLinks(tempDir, "my-cli", pkg);
    await removeBinLinks(tempDir, pkg);

    const binDir = join(tempDir, "node_modules", ".bin");
    expect(await exists(join(binDir, "my-cli"))).toBe(false);
    if (platform() === "win32") {
      expect(await exists(join(binDir, "my-cli.cmd"))).toBe(false);
    }
  });
});
