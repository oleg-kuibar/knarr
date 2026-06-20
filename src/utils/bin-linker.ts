import {
  mkdir,
  symlink,
  writeFile,
  chmod,
  rm,
  lstat,
  readFile,
  readlink,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import { consola } from "./console.js";
import type { PackageJson } from "../types.js";
import { exists, isNodeError } from "./fs.js";
import { isDryRun, verbose } from "./logger.js";
import { normalizePath } from "./paths.js";
import { recordMutation } from "./dry-run.js";

const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;
const SAFE_INTERPRETER_RE = /^[A-Za-z0-9._+-]+$/;

function safeInterpreter(value: string | undefined): string {
  return value && SAFE_INTERPRETER_RE.test(value) ? value : "node";
}

export function parseShebangInterpreter(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith("#!")) return "node";

  const command = firstLine.slice(2).trim();
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "node";

  const executable = parts[0].replace(/\\/g, "/").split("/").pop();
  if (executable === "env") {
    const args = parts.slice(1);
    const interpreter = args[0] === "-S" ? args[1] : args[0];
    return safeInterpreter(interpreter);
  }

  return safeInterpreter(executable);
}

async function readBinInterpreter(targetAbsolute: string): Promise<string> {
  try {
    return parseShebangInterpreter(await readFile(targetAbsolute, "utf-8"));
  } catch {
    return "node";
  }
}

function resolveBinPath(binDir: string, binName: string, suffix = ""): string | null {
  if (
    !binName ||
    binName === "." ||
    binName === ".." ||
    CONTROL_CHARS_RE.test(binName) ||
    binName.includes("/") ||
    binName.includes("\\") ||
    binName.includes(":")
  ) {
    return null;
  }

  const path = join(binDir, `${binName}${suffix}`);
  const resolvedBinDir = resolve(binDir);
  const resolvedPath = resolve(path);
  if (
    resolvedPath !== resolvedBinDir &&
    resolvedPath.startsWith(resolvedBinDir + sep)
  ) {
    return path;
  }

  return null;
}

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

  const binDir = join(consumerPath, "node_modules", ".bin");
  const safeEntries = Object.entries(entries)
    .map(([binName, binPath]) => ({
      binName,
      binPath,
      linkPath: resolveBinPath(binDir, binName),
      cmdPath: resolveBinPath(binDir, binName, ".cmd"),
      ps1Path: resolveBinPath(binDir, binName, ".ps1"),
    }))
    .filter((entry): entry is {
      binName: string;
      binPath: string;
      linkPath: string;
      cmdPath: string;
      ps1Path: string;
    } => {
      if (!entry.linkPath || !entry.cmdPath || !entry.ps1Path) {
        consola.warn(`bin name "${entry.binName}" is not safe, skipping`);
        return false;
      }
      return true;
    });
  const packageRoot = join(consumerPath, "node_modules", packageName);
  const resolvedPackageRoot = resolve(packageRoot);
  const validEntries = safeEntries.filter(({ binName, binPath }) => {
    const resolvedTarget = resolve(join(packageRoot, binPath));
    if (
      resolvedTarget.startsWith(resolvedPackageRoot + sep) ||
      resolvedTarget === resolvedPackageRoot
    ) {
      return true;
    }
    consola.warn(`bin "${binName}" points outside package directory, skipping`);
    return false;
  });
  if (validEntries.length === 0) return 0;

  if (isDryRun()) {
    for (const { linkPath } of validEntries) {
      recordMutation({ type: "bin-link", path: linkPath, detail: packageName });
    }
    verbose(`[dry-run] would create ${validEntries.length} bin link(s) for ${packageName}`);
    return validEntries.length;
  }

  await mkdir(binDir, { recursive: true });

  const isWindows = platform() === "win32";
  let count = 0;

  for (const { binName, binPath, linkPath, cmdPath, ps1Path } of validEntries) {
    const targetAbsolute = join(packageRoot, binPath);
    const targetRelative = normalizePath(relative(binDir, targetAbsolute));
    const interpreter = await readBinInterpreter(targetAbsolute);

    if (isWindows) {
      // Create .cmd wrapper
      const targetWindows = targetRelative.replace(/\//g, "\\");
      const cmdContent = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nCALL :find_dp0\r\n${interpreter} "%dp0%\\${targetWindows}" %*\r\n`;
      await writeFile(cmdPath, cmdContent);

      // Create .ps1 wrapper for PowerShell
      const ps1Content = `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& ${interpreter} "$basedir/${targetRelative}" $args\nexit $LASTEXITCODE\n`;
      await writeFile(ps1Path, ps1Content);

      // Also create a shell script for Git Bash/WSL
      const shContent = `#!/bin/sh\nbasedir=$(dirname "$0")\nexec ${interpreter} "$basedir/${targetRelative}" "$@"\n`;
      await writeFile(linkPath, shContent);
    } else {
      // Unix: create symlink
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
          const shContent = `#!/bin/sh\nbasedir=$(dirname "$0")\nexec ${interpreter} "$basedir/${targetRelative}" "$@"\n`;
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
  const binDir = join(consumerPath, "node_modules", ".bin");
  const safeEntries = Object.keys(entries)
    .map((binName) => ({
      binName,
      linkPath: resolveBinPath(binDir, binName),
      cmdPath: resolveBinPath(binDir, binName, ".cmd"),
      ps1Path: resolveBinPath(binDir, binName, ".ps1"),
    }))
    .filter(
      (entry): entry is {
        binName: string;
        linkPath: string;
        cmdPath: string;
        ps1Path: string;
      } => !!entry.linkPath && !!entry.cmdPath && !!entry.ps1Path
    );

  if (isDryRun()) {
    for (const { linkPath } of safeEntries) {
      recordMutation({ type: "bin-unlink", path: linkPath });
    }
    verbose(`[dry-run] would remove ${safeEntries.length} bin link(s)`);
    return;
  }
  const isWindows = platform() === "win32";
  const packageRoot = join(consumerPath, "node_modules", pkg.name);

  for (const { linkPath, cmdPath, ps1Path } of safeEntries) {
    try {
      if (await binFileBelongsToPackage(binDir, linkPath, packageRoot)) {
        await rm(linkPath, { force: true });
      }
      if (isWindows) {
        if (await binFileBelongsToPackage(binDir, cmdPath, packageRoot)) {
          await rm(cmdPath, { force: true });
        }
        if (await binFileBelongsToPackage(binDir, ps1Path, packageRoot)) {
          await rm(ps1Path, { force: true });
        }
      }
    } catch {
      // ignore
    }
  }
}

async function binFileBelongsToPackage(
  binDir: string,
  linkPath: string,
  packageRoot: string
): Promise<boolean> {
  let fileStat;
  try {
    fileStat = await lstat(linkPath);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return false;
    throw err;
  }

  const resolvedPackageRoot = resolve(packageRoot);
  if (fileStat.isSymbolicLink()) {
    const target = await readlink(linkPath);
    const resolvedTarget = resolve(binDir, target);
    return (
      resolvedTarget === resolvedPackageRoot ||
      resolvedTarget.startsWith(resolvedPackageRoot + sep)
    );
  }

  if (!fileStat.isFile()) return false;

  const content = await readFile(linkPath, "utf-8");
  const relPackageRoot = normalizePath(relative(binDir, packageRoot));
  const relWindowsPackageRoot = relPackageRoot.replace(/\//g, "\\");
  return (
    content.includes(`${relPackageRoot}/`) ||
    content.includes(`${relPackageRoot}"`) ||
    content.includes(`${relWindowsPackageRoot}\\`) ||
    content.includes(`${relWindowsPackageRoot}"`)
  );
}
