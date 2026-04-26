import { mkdir, symlink, writeFile, chmod, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import { consola } from "./console.js";
import type { PackageJson } from "../types.js";
import { exists, isNodeError } from "./fs.js";
import { isDryRun, verbose } from "./logger.js";
import { normalizePath } from "./paths.js";
import { recordMutation } from "./dry-run.js";

/**
 * Resolve the bin entries from a package.json.
 * Returns a map of bin name → relative file path.
 */
export function resolveBinEntries(
  pkg: PackageJson
): Record<string, string> {
  if (!pkg.bin) return {};

  if (typeof pkg.bin === "string") {
    // Single bin: use package name (without scope)
    const binName = pkg.name.startsWith("@")
      ? pkg.name.split("/")[1]
      : pkg.name;
    return { [binName]: pkg.bin };
  }

  return pkg.bin;
}

/**
 * Create bin links in node_modules/.bin/ for a package.
 * On Unix: symlinks (with shell wrapper fallback for permission errors)
 * On Windows: .cmd wrapper scripts
 */
export async function createBinLinks(
  consumerPath: string,
  packageName: string,
  pkg: PackageJson
): Promise<number> {
  const entries = resolveBinEntries(pkg);
  if (Object.keys(entries).length === 0) return 0;

  if (isDryRun()) {
    for (const binName of Object.keys(entries)) {
      recordMutation({ type: "bin-link", path: join(consumerPath, "node_modules", ".bin", binName), detail: packageName });
    }
    verbose(`[dry-run] would create ${Object.keys(entries).length} bin link(s) for ${packageName}`);
    return Object.keys(entries).length;
  }

  const binDir = join(consumerPath, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });

  const isWindows = platform() === "win32";
  let count = 0;

  for (const [binName, binPath] of Object.entries(entries)) {
    const packageRoot = join(consumerPath, "node_modules", packageName);
    const targetAbsolute = join(packageRoot, binPath);
    const resolvedTarget = resolve(targetAbsolute);
    if (!resolvedTarget.startsWith(resolve(packageRoot) + sep) && resolvedTarget !== resolve(packageRoot)) {
      consola.warn(`bin "${binName}" points outside package directory, skipping`);
      continue;
    }
    const targetRelative = normalizePath(relative(binDir, targetAbsolute));

    if (isWindows) {
      // Create .cmd wrapper
      const cmdPath = join(binDir, `${binName}.cmd`);
      const targetWindows = targetRelative.replace(/\//g, "\\");
      const cmdContent = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nCALL :find_dp0\r\n"%dp0%\\${targetWindows}" %*\r\n`;
      await writeFile(cmdPath, cmdContent);

      // Create .ps1 wrapper for PowerShell
      const ps1Path = join(binDir, `${binName}.ps1`);
      const ps1Content = `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& node "$basedir/${targetRelative}" $args\nexit $LASTEXITCODE\n`;
      await writeFile(ps1Path, ps1Content);

      // Also create a shell script for Git Bash/WSL
      const shPath = join(binDir, binName);
      const shContent = `#!/bin/sh\nexec node "${targetRelative}" "$@"\n`;
      await writeFile(shPath, shContent);
    } else {
      // Unix: create symlink
      const linkPath = join(binDir, binName);
      try {
        await rm(linkPath, { force: true });
      } catch {
        // ignore
      }

      try {
        await symlink(targetRelative, linkPath);
        await chmod(targetAbsolute, 0o755);
      } catch (err) {
        if (isNodeError(err) && (err.code === "EPERM" || err.code === "EACCES")) {
          // Symlink not permitted — fall back to shell wrapper script
          verbose(`[bin-linker] Symlink failed (${err.code}), using shell wrapper for ${binName}`);
          const shContent = `#!/bin/sh\nexec node "${targetRelative}" "$@"\n`;
          await writeFile(linkPath, shContent);
          await chmod(linkPath, 0o755);
        } else {
          throw err;
        }
      }
    }

    count++;
  }

  return count;
}

/**
 * Remove bin links for a package from node_modules/.bin/
 */
export async function removeBinLinks(
  consumerPath: string,
  pkg: PackageJson
): Promise<void> {
  const entries = resolveBinEntries(pkg);
  if (isDryRun()) {
    for (const binName of Object.keys(entries)) {
      recordMutation({ type: "bin-unlink", path: join(consumerPath, "node_modules", ".bin", binName) });
    }
    verbose(`[dry-run] would remove ${Object.keys(entries).length} bin link(s)`);
    return;
  }
  const binDir = join(consumerPath, "node_modules", ".bin");
  const isWindows = platform() === "win32";

  for (const binName of Object.keys(entries)) {
    try {
      await rm(join(binDir, binName), { force: true });
      if (isWindows) {
        await rm(join(binDir, `${binName}.cmd`), { force: true });
        await rm(join(binDir, `${binName}.ps1`), { force: true });
      }
    } catch {
      // ignore
    }
  }
}
