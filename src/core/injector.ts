import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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
  cacheInvalidations: number;
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
  const targetDir = await resolveInjectionTarget(
    consumerPath,
    storeEntry.name,
    pm,
    storeEntry.version
  );

  verbose(`[inject] ${storeEntry.name}@${storeEntry.version} → ${targetDir}`);

  await ensureDir(targetDir);
  const previousPkg = await readPackageJson(targetDir);
  const { copied, removed, skipped } = await incrementalCopy(
    storeEntry.packageDir,
    targetDir,
    { force: options.force }
  );

  verbose(`[inject] ${copied} copied, ${removed} removed, ${skipped} skipped`);

  const cacheInvalidations =
    copied > 0 || removed > 0 ? await invalidateBundlerCache(consumerPath) : 0;

  // Read the published package.json for bin links
  const pkg = await readPackageJson(storeEntry.packageDir);
  if (previousPkg) {
    await removeBinLinks(consumerPath, previousPkg);
  }
  const binLinks = pkg ? await createBinLinks(consumerPath, storeEntry.name, pkg) : 0;

  if (binLinks > 0) {
    verbose(`[inject] Created ${binLinks} bin link(s)`);
  }

  return { copied, removed, skipped, binLinks, cacheInvalidations };
}

/**
 * Back up the existing installed version of a package before overwriting.
 */
export async function backupExisting(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<boolean> {
  const installedDir = await resolveInjectionTarget(consumerPath, packageName, pm);
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

  const targetDir = await resolveInjectionTarget(consumerPath, packageName, pm);
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
  const targetDir = await resolveInjectionTarget(consumerPath, packageName, pm);
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
export async function resolveInjectionTarget(
  consumerPath: string,
  packageName: string,
  pm: PackageManager,
  version?: string,
  options: { warnOnFallback?: boolean } = {}
): Promise<string> {
  const directPath = getNodeModulesPackagePath(consumerPath, packageName);

  const needsSymlinkResolution =
    pm === "pnpm" ||
    (pm === "yarn" && (await detectYarnNodeLinker(consumerPath)) === "pnpm");

  if (!needsSymlinkResolution) {
    return directPath;
  }

  const pnpmDirs = await getPnpmVirtualStoreDirs(consumerPath);

  // pnpm / yarn pnpm-linker: follow symlink into the configured virtual store
  try {
    const realPath = await resolveRealPath(directPath);
    if (realPath !== resolve(directPath)) {
      if (!(await isPnpmVirtualStorePackageRealPath(pnpmDirs, packageName, realPath))) {
        throw new Error(
          `Refusing to inject ${packageName}: node_modules entry resolves outside a configured pnpm virtual store (${realPath})`
        );
      }
      verbose(`[inject] pnpm: resolved symlink → ${realPath}`);
      return realPath;
    }
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // Symlink doesn't exist yet, fall through
    } else {
      if (isNodeError(err)) {
        consola.debug(`pnpm symlink resolution error: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    }
  }

  // If no direct symlink exists, try to find the package in known pnpm virtual stores.
  const existingPnpmDirs: string[] = [];
  for (const pnpmDir of pnpmDirs) {
    if (await exists(pnpmDir)) {
      existingPnpmDirs.push(pnpmDir);
    }
  }

  if (existingPnpmDirs.length > 0) {
    if (!(await isDeclaredConsumerDependency(consumerPath, packageName))) {
      verbose(
        `[inject] pnpm: ${packageName} is not declared by the consumer, skipping virtual store scan`
      );
      return directPath;
    }

    const encodedName = packageName.replaceAll("/", "+");

    for (const pnpmDir of existingPnpmDirs) {
      verbose(`[inject] pnpm: scanning ${relative(consumerPath, pnpmDir) || "."} for ${packageName}`);

      // Try exact version match first
      if (version) {
        const exactEntry = `${encodedName}@${version}`;
        const candidate = await resolvePnpmCandidate(
          pnpmDir,
          packageName,
          join(pnpmDir, exactEntry, "node_modules", packageName)
        );
        if (candidate) {
          verbose(`[inject] pnpm: exact version match in virtual store → ${candidate}`);
          return candidate;
        }
      }

      // Fall back to a peer-suffixed match for the requested version, if present.
      const entries = await readdir(pnpmDir);
      for (const entry of entries) {
        if (matchesPnpmPackageEntry(encodedName, version, entry)) {
          const candidate = await resolvePnpmCandidate(
            pnpmDir,
            packageName,
            join(pnpmDir, entry, "node_modules", packageName)
          );
          if (candidate) {
            verbose(`[inject] pnpm: found in virtual store → ${candidate}`);
            return candidate;
          }
        }
      }
    }
  }

  // Fall back to direct path
  if (options.warnOnFallback !== false) {
    consola.warn(
      `pnpm: Could not find ${packageName} in a configured virtual store, using direct node_modules path. ` +
      `If this causes issues, run 'pnpm install' to rebuild the virtual store, then 'knarr add' again.`
    );
  }
  return directPath;
}

async function resolvePnpmCandidate(
  pnpmDir: string,
  packageName: string,
  candidatePath: string
): Promise<string | null> {
  if (!isPnpmVirtualStorePackagePathFromRoot(pnpmDir, packageName, candidatePath)) {
    return null;
  }

  try {
    const [pnpmRoot, realPath] = await Promise.all([
      realpath(pnpmDir),
      realpath(candidatePath),
    ]);
    if (!isPnpmVirtualStorePackagePathFromRoot(pnpmRoot, packageName, realPath)) {
      throw new Error(
        `Refusing to inject ${packageName}: virtual store candidate resolves outside a configured pnpm virtual store (${realPath})`
      );
    }
    return realPath;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

function matchesPnpmPackageEntry(
  encodedName: string,
  version: string | undefined,
  entry: string
): boolean {
  if (!version) return entry.startsWith(`${encodedName}@`);

  const exactEntry = `${encodedName}@${version}`;
  return entry === exactEntry || entry.startsWith(`${exactEntry}_`);
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

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function getPnpmVirtualStoreDirs(consumerPath: string): Promise<string[]> {
  const nodeModulesDir = join(consumerPath, "node_modules");
  const dirs = [join(nodeModulesDir, ".pnpm")];
  const configured = await readConfiguredPnpmVirtualStoreDir(nodeModulesDir);
  if (!configured) return dirs;

  const configuredDir = isAbsolute(configured)
    ? configured
    : resolve(nodeModulesDir, configured);
  if (!dirs.some((dir) => resolve(dir) === resolve(configuredDir))) {
    dirs.push(configuredDir);
  }
  return dirs;
}

async function readConfiguredPnpmVirtualStoreDir(nodeModulesDir: string): Promise<string | null> {
  try {
    const content = await readFile(join(nodeModulesDir, ".modules.yaml"), "utf-8");
    return parsePnpmVirtualStoreDir(content);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

function parsePnpmVirtualStoreDir(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { virtualStoreDir?: unknown };
    if (typeof parsed.virtualStoreDir === "string" && parsed.virtualStoreDir.trim()) {
      return parsed.virtualStoreDir.trim();
    }
  } catch {
    // pnpm has used YAML-compatible metadata; fall back to a top-level scalar scan.
  }

  const match = content.match(/^virtualStoreDir:\s*(.+?)\s*$/m);
  if (!match) return null;

  let value = match[1].trim().replace(/\s+#.*$/, "");
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value || null;
}

async function isPnpmVirtualStorePackageRealPath(
  pnpmDirs: string[],
  packageName: string,
  targetPath: string
): Promise<boolean> {
  for (const pnpmDir of pnpmDirs) {
    try {
      const pnpmRoot = await realpath(pnpmDir);
      if (isPnpmVirtualStorePackagePathFromRoot(pnpmRoot, packageName, targetPath)) {
        return true;
      }
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") continue;
      throw err;
    }
  }
  return false;
}

function isPnpmVirtualStorePackagePathFromRoot(
  pnpmDir: string,
  packageName: string,
  targetPath: string
): boolean {
  if (!isInside(pnpmDir, targetPath)) return false;

  const rel = relative(pnpmDir, targetPath).replace(/\\/g, "/");
  const suffix = `node_modules/${packageName}`.replace(/\\/g, "/");
  return rel === suffix || rel.endsWith(`/${suffix}`);
}

async function isDeclaredConsumerDependency(
  consumerPath: string,
  packageName: string
): Promise<boolean> {
  const pkg = await readPackageJson(consumerPath);
  if (!pkg) return false;
  return Boolean(
    pkg.dependencies?.[packageName] ||
      pkg.devDependencies?.[packageName] ||
      pkg.optionalDependencies?.[packageName] ||
      pkg.peerDependencies?.[packageName]
  );
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
