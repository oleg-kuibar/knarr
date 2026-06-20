import { lstat, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
import { isDryRun, verbose } from "../utils/logger.js";
import { recordMutation } from "../utils/dry-run.js";
import {
  detectPackageManager,
  detectYarnNodeLinker,
  detectYarnPnpmStoreFolder,
  isYarnPnpProject,
} from "../utils/pm-detect.js";
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
 * - yarn with nodeLinker: pnpm: follow .store/ structure
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
    storeEntry.version,
    { repairMissingLink: true }
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
  pm: PackageManager,
  version?: string
): Promise<boolean> {
  const backupDir = getConsumerBackupPath(consumerPath, packageName);
  if (!(await exists(backupDir))) return false;

  const targetDir = await resolveInjectionTarget(consumerPath, packageName, pm, version);
  const currentPkg = await readPackageJson(targetDir);
  if (currentPkg) {
    await removeBinLinks(consumerPath, currentPkg);
  }
  await removeDir(targetDir);
  await copyDir(backupDir, targetDir);
  const restoredPkg = await readPackageJson(isDryRun() ? backupDir : targetDir);
  if (restoredPkg) {
    const binLinks = await createBinLinks(consumerPath, packageName, restoredPkg);
    if (binLinks > 0) {
      verbose(`[restore] Restored ${binLinks} original bin link(s) for ${packageName}`);
    }
  }
  await removeDir(backupDir);
  return true;
}

/**
 * Remove an injected package from node_modules.
 */
export async function removeInjected(
  consumerPath: string,
  packageName: string,
  pm: PackageManager,
  version?: string
): Promise<void> {
  const targetDir = await resolveInjectionTarget(consumerPath, packageName, pm, version);
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
  consumerPath: string,
  pm?: PackageManager
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
      installed: await isDependencyInstalledForPackage(dep, storeEntry, consumerPath, pm),
    }))
  );
  return results.filter((r) => !r.installed).map((r) => r.dep);
}

async function isDependencyInstalledForPackage(
  dependencyName: string,
  storeEntry: StoreEntry,
  consumerPath: string,
  pm?: PackageManager
): Promise<boolean> {
  if (await exists(join(consumerPath, "node_modules", dependencyName))) {
    return true;
  }

  if (!pm) return false;

  const targetDir = await resolveInjectionTarget(
    consumerPath,
    storeEntry.name,
    pm,
    storeEntry.version,
    { warnOnFallback: false }
  );
  return dependencyVisibleFromDirectory(targetDir, dependencyName);
}

async function dependencyVisibleFromDirectory(
  startDir: string,
  dependencyName: string
): Promise<boolean> {
  const realStart = await realpath(startDir).catch((err: unknown) => {
    if (isNodeError(err) && err.code === "ENOENT") return startDir;
    throw err;
  });

  let dir = realStart;
  for (;;) {
    if (await exists(join(dir, "node_modules", dependencyName))) {
      return true;
    }

    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
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
  options: { warnOnFallback?: boolean; repairMissingLink?: boolean } = {}
): Promise<string> {
  const directPath = getNodeModulesPackagePath(consumerPath, packageName);
  const currentPm = await detectPackageManager(consumerPath);
  if ((pm === "yarn" || currentPm === "yarn") && await isYarnPnpProject(consumerPath)) {
    throw new Error(
      "Yarn PnP mode is not compatible with Knarr. Set `nodeLinker: node-modules` or `nodeLinker: pnpm` in .yarnrc.yml, then run `yarn install`."
    );
  }

  const yarnLinker = pm === "yarn" || currentPm === "yarn"
    ? await detectYarnNodeLinker(consumerPath)
    : null;
  const storeKind = getEffectiveStoreKind(pm, currentPm, yarnLinker);

  if (!storeKind) {
    return directPath;
  }

  const virtualStoreDirs = storeKind === "pnpm"
    ? await getPnpmVirtualStoreDirs(consumerPath)
    : await getYarnPnpmStoreDirs(consumerPath);

  // pnpm / Yarn pnpm-linker: follow the package symlink into its virtual store.
  try {
    const realPath = await resolvePackageEntrySymlink(directPath);
    if (realPath) {
      const valid = storeKind === "pnpm"
        ? await isPnpmVirtualStorePackageRealPath(virtualStoreDirs, packageName, realPath)
        : await isYarnPnpmStorePackageRealPath(virtualStoreDirs, realPath);
      if (!valid) {
        throw new Error(
          `Refusing to inject ${packageName}: node_modules entry resolves outside a configured ${storeKindLabel(storeKind)} virtual store (${realPath})`
        );
      }
      await validateResolvedPackageIdentity(realPath, packageName, version, storeKind);
      verbose(`[inject] ${storeKindLabel(storeKind)}: resolved symlink → ${realPath}`);
      return realPath;
    }
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // Symlink doesn't exist yet, fall through
    } else {
      if (isNodeError(err)) {
        consola.debug(`${storeKindLabel(storeKind)} symlink resolution error: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    }
  }

  // If no direct symlink exists, try to find the package in known virtual stores.
  const existingStoreDirs: string[] = [];
  for (const storeDir of virtualStoreDirs) {
    if (await exists(storeDir)) {
      existingStoreDirs.push(storeDir);
    }
  }

  if (existingStoreDirs.length > 0) {
    if (!(await isDeclaredConsumerDependency(consumerPath, packageName))) {
      verbose(
        `[inject] ${storeKindLabel(storeKind)}: ${packageName} is not declared by the consumer, skipping virtual store scan`
      );
      return directPath;
    }

    if (storeKind === "yarn-pnpm") {
      for (const storeDir of existingStoreDirs) {
        verbose(`[inject] yarn-pnpm: scanning ${relative(consumerPath, storeDir) || "."} for ${packageName}`);
        const candidate = await resolveYarnPnpmCandidate(
          storeDir,
          packageName,
          version
        );
        if (candidate) {
          verbose(`[inject] yarn-pnpm: found in virtual store → ${candidate}`);
          if (options.repairMissingLink) {
            await repairMissingVirtualStoreLink(directPath, candidate, packageName, storeKind);
          }
          return candidate;
        }
      }
    }

    if (storeKind === "pnpm") {
      const encodedName = packageName.replaceAll("/", "+");

      for (const pnpmDir of existingStoreDirs) {
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
            if (options.repairMissingLink) {
              await repairMissingVirtualStoreLink(directPath, candidate, packageName, storeKind);
            }
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
              if (options.repairMissingLink) {
                await repairMissingVirtualStoreLink(directPath, candidate, packageName, storeKind);
              }
              return candidate;
            }
          }
        }
      }
    }
  }

  // Fall back to direct path
  if (options.warnOnFallback !== false) {
    consola.warn(
      `${storeKindLabel(storeKind)}: Could not find ${packageName} in a configured virtual store, using direct node_modules path. ` +
      `If this causes issues, run your package manager's install command to rebuild the virtual store, then 'knarr add' again.`
    );
  }
  return directPath;
}

function storeKindLabel(kind: "pnpm" | "yarn-pnpm"): string {
  return kind === "pnpm" ? "pnpm" : "Yarn pnpm-linker";
}

function getEffectiveStoreKind(
  storedPm: PackageManager,
  currentPm: PackageManager,
  yarnLinker: "node-modules" | "pnpm" | "pnp" | null
): "pnpm" | "yarn-pnpm" | null {
  if (currentPm === "yarn") {
    return yarnLinker === "pnpm" ? "yarn-pnpm" : null;
  }
  if (currentPm === "pnpm") return "pnpm";
  if (currentPm === "bun") return null;

  // npm is also the no-evidence fallback from detectPackageManager(), so keep
  // the tracked package manager as a fallback for existing links.
  if (storedPm === "yarn") {
    return yarnLinker === "pnpm" ? "yarn-pnpm" : null;
  }
  return storedPm === "pnpm" ? "pnpm" : null;
}

async function resolvePackageEntrySymlink(
  linkPath: string
): Promise<string | null> {
  const linkStat = await lstat(linkPath);
  if (!linkStat.isSymbolicLink()) return null;
  return realpath(linkPath);
}

async function validateResolvedPackageIdentity(
  targetDir: string,
  packageName: string,
  version: string | undefined,
  storeKind: "pnpm" | "yarn-pnpm"
): Promise<void> {
  const pkg = await readPackageJson(targetDir);
  if (!pkg) return;
  if (pkg.name && pkg.name !== packageName) {
    throw new Error(
      `Refusing to inject ${packageName}: ${storeKindLabel(storeKind)} target contains package "${pkg.name}"`
    );
  }
  if (version && pkg.version && pkg.version !== version) {
    throw new Error(
      `Refusing to inject ${packageName}@${version}: ${storeKindLabel(storeKind)} target contains version ${pkg.version}`
    );
  }
}

async function repairMissingVirtualStoreLink(
  directPath: string,
  targetDir: string,
  packageName: string,
  storeKind: "pnpm" | "yarn-pnpm"
): Promise<void> {
  let removeDanglingSymlink = false;
  try {
    const directStat = await lstat(directPath);
    if (!directStat.isSymbolicLink()) return;
    removeDanglingSymlink = true;
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") throw err;
  }

  const linkParent = dirname(directPath);
  if (isDryRun()) {
    const targetRelative = relative(linkParent, targetDir);
    verbose(
      `[inject] ${storeKindLabel(storeKind)}: would restore node_modules symlink for ${packageName} → ${targetRelative}`
    );
    recordMutation({
      type: "write",
      path: directPath,
      dest: targetDir,
      detail: `${storeKindLabel(storeKind)} package symlink`,
    });
    return;
  }

  await ensureDir(linkParent);
  const linkParentReal = await realpath(linkParent).catch(() => linkParent);
  const targetRelative = relative(linkParentReal, targetDir);
  verbose(
    `[inject] ${storeKindLabel(storeKind)}: restoring node_modules symlink for ${packageName} → ${targetRelative}`
  );
  if (removeDanglingSymlink) {
    await rm(directPath, { force: true });
  }
  await symlink(targetRelative, directPath, "dir");
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

async function resolveYarnPnpmCandidate(
  storeDir: string,
  packageName: string,
  version: string | undefined
): Promise<string | null> {
  const entries = await readdir(storeDir);
  for (const entry of entries) {
    const candidatePath = join(storeDir, entry, "package");
    const pkg = await readPackageJson(candidatePath);
    if (!pkg || pkg.name !== packageName) continue;
    if (version && pkg.version !== version) continue;

    const [storeRoot, realPath] = await Promise.all([
      realpath(storeDir),
      realpath(candidatePath),
    ]);
    if (!isYarnPnpmStorePackagePathFromRoot(storeRoot, realPath)) {
      throw new Error(
        `Refusing to inject ${packageName}: virtual store candidate resolves outside a configured Yarn pnpm-linker virtual store (${realPath})`
      );
    }
    return realPath;
  }
  return null;
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

async function getYarnPnpmStoreDirs(consumerPath: string): Promise<string[]> {
  const nodeModulesDir = join(consumerPath, "node_modules");
  const dirs = [join(nodeModulesDir, ".store")];
  const configured = await detectYarnPnpmStoreFolder(consumerPath);
  if (!configured) return dirs;

  const configuredDir = isAbsolute(configured)
    ? configured
    : resolve(consumerPath, configured);
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

async function isYarnPnpmStorePackageRealPath(
  storeDirs: string[],
  targetPath: string
): Promise<boolean> {
  for (const storeDir of storeDirs) {
    try {
      const storeRoot = await realpath(storeDir);
      if (isYarnPnpmStorePackagePathFromRoot(storeRoot, targetPath)) {
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

function isYarnPnpmStorePackagePathFromRoot(
  storeDir: string,
  targetPath: string
): boolean {
  if (!isInside(storeDir, targetPath)) return false;

  const rel = relative(storeDir, targetPath).replace(/\\/g, "/");
  const parts = rel.split("/");
  return parts.length === 2 && parts[1] === "package";
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
