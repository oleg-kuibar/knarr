import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { consola } from "../utils/console.js";
import type { PackageJson, PackageManager, StoreEntry } from "../types.js";
import { getNodeModulesPackagePath, getConsumerBackupPath } from "../utils/paths.js";
import {
  incrementalCopy,
  removeDir,
  ensureDir,
  exists,
  copyDir,
  isNodeError,
} from "../utils/fs.js";
import { createBinLinks, removeBinLinks } from "../utils/bin-linker.js";
import { verbose } from "../utils/logger.js";
import { detectYarnNodeLinker } from "../utils/pm-detect.js";
import { invalidateBundlerCache } from "../utils/bundler-cache.js";

export interface InjectResult {
  copied: number;
  removed: number;
  skipped: number;
  binLinks: number;
}

export interface InjectOptions {
  /** Force copy all files, bypassing hash comparison */
  force?: boolean;
}

/**
 * Inject a package from the store into a consumer's node_modules.
 * Strategy depends on the package manager:
 * - npm/yarn/bun: direct node_modules/<pkg>/
 * - pnpm: follow .pnpm/ structure
 */
export async function inject(
  storeEntry: StoreEntry,
  consumerPath: string,
  pm: PackageManager,
  options: InjectOptions = {}
): Promise<InjectResult> {
  const targetDir = await resolveTargetDir(
    consumerPath,
    storeEntry.name,
    pm,
    storeEntry.version
  );

  verbose(`[inject] ${storeEntry.name}@${storeEntry.version} → ${targetDir}`);

  await ensureDir(targetDir);
  const { copied, removed, skipped } = await incrementalCopy(
    storeEntry.packageDir,
    targetDir,
    { force: options.force }
  );

  verbose(`[inject] ${copied} copied, ${removed} removed, ${skipped} skipped`);

  if (copied > 0 || removed > 0) {
    await invalidateBundlerCache(consumerPath);
  }

  // Read the published package.json for bin links
  const pkg = await readPackageJson(storeEntry.packageDir);
  const binLinks = pkg ? await createBinLinks(consumerPath, storeEntry.name, pkg) : 0;

  if (binLinks > 0) {
    verbose(`[inject] Created ${binLinks} bin link(s)`);
  }

  return { copied, removed, skipped, binLinks };
}

/**
 * Back up the existing installed version of a package before overwriting.
 */
export async function backupExisting(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<boolean> {
  const installedDir = await resolveTargetDir(consumerPath, packageName, pm);
  if (!(await exists(installedDir))) return false;

  const backupDir = getConsumerBackupPath(consumerPath, packageName);
  await removeDir(backupDir);
  await copyDir(installedDir, backupDir);
  return true;
}

/**
 * Restore a backed-up package to node_modules.
 */
export async function restoreBackup(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<boolean> {
  const backupDir = getConsumerBackupPath(consumerPath, packageName);
  if (!(await exists(backupDir))) return false;

  const targetDir = await resolveTargetDir(consumerPath, packageName, pm);
  await removeDir(targetDir);
  await copyDir(backupDir, targetDir);
  await removeDir(backupDir);
  return true;
}

/**
 * Remove an injected package from node_modules.
 */
export async function removeInjected(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<void> {
  const targetDir = await resolveTargetDir(consumerPath, packageName, pm);
  const pkg = await readPackageJson(targetDir);
  if (pkg) {
    await removeBinLinks(consumerPath, pkg);
  }
  await removeDir(targetDir);
}

/**
 * Check for missing transitive dependencies.
 * Returns a list of dependency names that are in the linked package's
 * dependencies but not installed in the consumer's node_modules.
 */
export async function checkMissingDeps(
  storeEntry: StoreEntry,
  consumerPath: string
): Promise<string[]> {
  const pkg = await readPackageJson(storeEntry.packageDir);
  if (!pkg) return [];

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...Object.fromEntries(
      Object.entries(pkg.peerDependencies ?? {}).filter(
        ([name]) => !pkg.peerDependenciesMeta?.[name]?.optional
      )
    ),
  };

  if (Object.keys(allDeps).length === 0) return [];

  const depNames = Object.keys(allDeps);
  const results = await Promise.all(
    depNames.map(async (dep) => ({
      dep,
      installed: await exists(join(consumerPath, "node_modules", dep)),
    }))
  );
  return results.filter((r) => !r.installed).map((r) => r.dep);
}

/**
 * Resolve the actual target directory in node_modules for a given
 * package manager strategy.
 */
async function resolveTargetDir(
  consumerPath: string,
  packageName: string,
  pm: PackageManager,
  version?: string
): Promise<string> {
  const directPath = getNodeModulesPackagePath(consumerPath, packageName);

  const needsSymlinkResolution =
    pm === "pnpm" ||
    (pm === "yarn" && (await detectYarnNodeLinker(consumerPath)) === "pnpm");

  if (!needsSymlinkResolution) {
    return directPath;
  }

  // pnpm / yarn pnpm-linker: follow symlink into .pnpm/ virtual store
  try {
    const realPath = await resolveRealPath(directPath);
    if (realPath !== resolve(directPath)) {
      verbose(`[inject] pnpm: resolved symlink → ${realPath}`);
      return realPath;
    }
  } catch (err) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      consola.debug(`pnpm symlink resolution error: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Symlink doesn't exist yet, fall through
  }

  // If no existing pnpm structure, try to find in .pnpm/
  const pnpmDir = join(consumerPath, "node_modules", ".pnpm");
  if (await exists(pnpmDir)) {
    verbose(`[inject] pnpm: scanning .pnpm/ for ${packageName}`);
    const encodedName = packageName.replaceAll("/", "+");

    // Try exact version match first
    if (version) {
      const exactEntry = `${encodedName}@${version}`;
      const candidate = join(pnpmDir, exactEntry, "node_modules", packageName);
      if (await exists(candidate)) {
        verbose(`[inject] pnpm: exact version match in .pnpm/ → ${candidate}`);
        return candidate;
      }
    }

    // Fall back to first prefix match
    const entries = await readdir(pnpmDir);
    for (const entry of entries) {
      if (entry.startsWith(encodedName + "@")) {
        const candidate = join(
          pnpmDir,
          entry,
          "node_modules",
          packageName
        );
        if (await exists(candidate)) {
          verbose(`[inject] pnpm: found in .pnpm/ → ${candidate}`);
          return candidate;
        }
      }
    }
  }

  // Fall back to direct path
  consola.warn(
    `pnpm: Could not find ${packageName} in .pnpm/ virtual store, using direct node_modules path. ` +
    `If this causes issues, run 'pnpm install' to rebuild the virtual store, then 'knarr add' again.`
  );
  return directPath;
}

/** Resolve a path through symlinks to its real location */
async function resolveRealPath(linkPath: string): Promise<string> {
  try {
    await stat(linkPath);
    return await realpath(linkPath);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return resolve(linkPath);
    }
    throw err;
  }
}

async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    const content = await readFile(join(dir, "package.json"), "utf-8");
    return JSON.parse(content) as PackageJson;
  } catch (err) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      consola.warn(`Failed to read package.json in ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}
