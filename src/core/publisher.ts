import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { join, relative, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { consola } from "../utils/console.js";
import pLimit from "../utils/concurrency.js";
import { availableParallelism } from "node:os";
import type { PackageJson, KnarrMeta, StoreEntry } from "../types.js";
import { getStorePackagePath, getStoreEntryPath } from "../utils/paths.js";
import { resolvePackFiles } from "../utils/pack-list.js";
import { computeContentHash } from "../utils/hash.js";
import { copyWithCoW, ensureDir, ensurePrivateDir, removeDir, moveDir, exists } from "../utils/fs.js";
import { readMeta, writeMeta } from "./store.js";
import { withFileLock } from "../utils/lockfile.js";
import type { Catalogs } from "../utils/workspace.js";
import { isDryRun, verbose } from "../utils/logger.js";
import { recordMutation } from "../utils/dry-run.js";

export interface PublishOptions {
  allowPrivate?: boolean;
  /** Whether to run prepack/postpack lifecycle hooks (default: true) */
  runScripts?: boolean;
  /** Force publish, bypassing hash comparison */
  force?: boolean;
  /** Max historical builds to keep (default: 3). Set to 0 to disable. */
  historyLimit?: number;
}

export interface PublishResult {
  name: string;
  version: string;
  fileCount: number;
  /** True if content was unchanged and publish was skipped */
  skipped: boolean;
  contentHash: string;
  /** 8-char hex identifier generated on each successful publish */
  buildId: string;
}

const copyLimit = pLimit(Math.max(availableParallelism(), 8));

/**
 * Publish a package from a directory to the Knarr store.
 *
 * 1. Read package.json, validate name and version
 * 2. Resolve publishable files
 * 3. Compute content hash
 * 4. Skip if hash matches existing store entry
 * 5. Copy files to temp dir, then atomic rename to store
 * 6. Write .knarr-meta.json
 */
export async function publish(
  packageDir: string,
  options: PublishOptions = {}
): Promise<PublishResult> {
  // 1. Read and validate package.json
  const pkgPath = join(packageDir, "package.json");
  let pkgContent: string;
  try {
    pkgContent = await readFile(pkgPath, "utf-8");
  } catch {
    throw new Error(`No package.json found in ${packageDir}`);
  }

  const pkg = JSON.parse(pkgContent) as PackageJson;
  if (!pkg.name) throw new Error("package.json missing 'name' field");
  if (!pkg.version) throw new Error("package.json missing 'version' field");
  if (pkg.private && !options.allowPrivate) {
    throw new Error(
      `Package "${pkg.name}" is private. Use --private flag to publish private packages.`
    );
  }

  // Run knarr lifecycle hook, with legacy plunk hook support.
  await runLifecycleHookAliases(packageDir, pkg, ["preknarr", "preplunk"]);

  // Run prepack lifecycle hook (unless --no-scripts)
  if (options.runScripts !== false) {
    await runLifecycleHook(packageDir, pkg, "prepack");
  }

  // 2. Resolve publishConfig.directory — determines where to read files from
  let publishDir = packageDir;
  if (pkg.publishConfig?.directory) {
    publishDir = resolve(packageDir, pkg.publishConfig.directory);
    try {
      const s = await stat(publishDir);
      if (!s.isDirectory()) {
        throw new Error(`publishConfig.directory "${pkg.publishConfig.directory}" is not a directory`);
      }
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`publishConfig.directory "${pkg.publishConfig.directory}" does not exist`);
      }
      throw err;
    }
    verbose(`[publish] Using publishConfig.directory: ${publishDir}`);
  }

  // 3. Resolve publishable files (from publishDir when publishConfig.directory is set)
  const filePkg = publishDir !== packageDir
    ? JSON.parse(await readFile(join(publishDir, "package.json"), "utf-8").catch(() => JSON.stringify(pkg))) as PackageJson
    : pkg;
  const files = await resolvePackFiles(publishDir, filePkg);
  if (files.length === 0) {
    throw new Error("No publishable files found");
  }
  verbose(`[publish] Resolved ${files.length} files for ${pkg.name}@${pkg.version}`);

  // 4. Compute content hash
  const contentHash = await computeContentHash(files, publishDir);

  // 5. Pre-load workspace versions and catalog definitions
  await preloadWorkspaceVersions(pkg, packageDir);
  await preloadCatalogs(pkg, packageDir);

  // 6. Fast path: check if already up to date (no lock needed)
  if (!options.force) {
    const existingMeta = await readMeta(pkg.name, pkg.version);
    if (existingMeta && existingMeta.contentHash === contentHash) {
      consola.info(`${pkg.name}@${pkg.version} already up to date (no changes since last publish)`);
      return {
        name: pkg.name,
        version: pkg.version,
        fileCount: files.length,
        skipped: true,
        contentHash,
        buildId: existingMeta.buildId ?? "",
      };
    }
  }

  // 7. Acquire lock and copy files to store (prevents concurrent publish corruption)
  const storeEntryDir = getStoreEntryPath(pkg.name, pkg.version);

  const result = await withFileLock(
    storeEntryDir + ".lock",
    async () => {
      // Re-check hash under lock — another process may have published while we waited
      if (!options.force) {
        const metaUnderLock = await readMeta(pkg.name, pkg.version);
        if (metaUnderLock && metaUnderLock.contentHash === contentHash) {
          consola.info(`${pkg.name}@${pkg.version} already up to date (no changes since last publish)`);
          return {
            name: pkg.name,
            version: pkg.version,
            fileCount: files.length,
            skipped: true,
            contentHash,
            buildId: metaUnderLock.buildId ?? "",
          } satisfies PublishResult;
        }
      }

      const tmpDir = storeEntryDir + `.tmp-${process.pid}-${Date.now()}`;
      const tmpPackageDir = join(tmpDir, "package");
      // Derive buildId from first 8 hex chars of contentHash (after "sha256v2:" prefix)
      const buildId = contentHash.slice(9, 17);

      try {
        await ensurePrivateDir(tmpPackageDir);

        // Handle workspace:* protocol and publishConfig field overrides
        let processedPkg = rewriteProtocolVersions(pkg);
        processedPkg = applyPublishConfig(processedPkg);

        verbose(`[publish] Copying files to temp store...`);

        // Pre-compute and create unique parent directories before parallel copy
        const uniqueDirs = new Set(
          files.map((file) => dirname(join(tmpPackageDir, relative(publishDir, file))))
        );
        await Promise.all([...uniqueDirs].map((d) => ensureDir(d)));

        // Copy files in parallel
        await Promise.all(
          files.map((file) =>
            copyLimit(async () => {
              const rel = relative(publishDir, file);
              const dest = join(tmpPackageDir, rel);

              if (rel === "package.json" && processedPkg !== pkg) {
                // Write the rewritten package.json
                await writeFile(dest, JSON.stringify(processedPkg, null, 2));
              } else {
                // Parent dirs already pre-created above
                await copyWithCoW(file, dest, { ensureParent: false });
              }
            })
          )
        );

        // If publishDir != packageDir, ensure we always write the processed package.json
        // (the files list from publishDir may have its own package.json or none)
        if (publishDir !== packageDir) {
          await writeFile(
            join(tmpPackageDir, "package.json"),
            JSON.stringify(processedPkg, null, 2)
          );
        }

        // Write metadata to temp dir
        const meta: KnarrMeta = {
          schemaVersion: 1,
          contentHash,
          publishedAt: new Date().toISOString(),
          sourcePath: packageDir,
          buildId,
        };
        await writeFile(
          join(tmpDir, ".knarr-meta.json"),
          JSON.stringify(meta, null, 2)
        );

        // Atomic swap: rename old aside, move temp to final, then capture history
        const hadOld = await exists(storeEntryDir);
        const oldDir = storeEntryDir + ".old-" + Date.now();
        if (hadOld) await rename(storeEntryDir, oldDir);
        await moveDir(tmpDir, storeEntryDir);

        // Capture old build to history AFTER the new entry is safely in place.
        // We read from `oldDir` (the renamed aside) so the live entry is never mutated.
        if (hadOld) {
          try {
            const { captureHistory } = await import("./history.js");
            await captureHistory(pkg.name, pkg.version, oldDir, options.historyLimit);
          } catch (err) {
            verbose(`[publish] History capture failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          await removeDir(oldDir);
        }

        verbose(`[publish] Stored at ${storeEntryDir}`);
      } catch (err) {
        // Clean up temp dir on failure
        await removeDir(tmpDir);
        throw err;
      }

      return {
        name: pkg.name,
        version: pkg.version,
        fileCount: files.length,
        skipped: false,
        contentHash,
        buildId,
      } satisfies PublishResult;
    },
    { stale: 60000 }
  );

  if (result.skipped) return result;

  // Run postpack lifecycle hook (unless --no-scripts)
  if (options.runScripts !== false) {
    await runLifecycleHook(packageDir, pkg, "postpack");
  }

  // Run knarr lifecycle hook (outside the lock so slow scripts don't hold it).
  await runLifecycleHookAliases(packageDir, pkg, ["postknarr", "postplunk"]);

  consola.success(
    `Published ${pkg.name}@${pkg.version} (${files.length} files) [${result.buildId}]`
  );

  return result;
}

const HOOK_TIMEOUT = parseInt(process.env.KNARR_HOOK_TIMEOUT ?? "30000", 10);

/**
 * Run a lifecycle hook script if defined in package.json scripts.
 */
async function runLifecycleHook(
  packageDir: string,
  pkg: PackageJson,
  hookName: string
): Promise<void> {
  const script = pkg.scripts?.[hookName];
  if (!script) return;

  if (isDryRun()) {
    recordMutation({
      type: "lifecycle-skip",
      path: packageDir,
      detail: `${hookName}: ${script}`,
    });
    return;
  }

  verbose(`[lifecycle] Running ${hookName}: ${script}`);
  return new Promise((resolve, reject) => {
    const isWin = platform() === "win32";
    const shell = isWin ? "cmd" : "sh";
    const shellFlag = isWin ? "/c" : "-c";

    const child = spawn(shell, [shellFlag, script], {
      cwd: packageDir,
      stdio: "inherit",
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${hookName} script timed out after ${HOOK_TIMEOUT / 1000}s. Increase KNARR_HOOK_TIMEOUT env var if the script needs more time.`));
    }, HOOK_TIMEOUT);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${hookName} script failed with exit code ${code}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`${hookName} script error: ${err.message}`));
    });
  });
}

async function runLifecycleHookAliases(
  packageDir: string,
  pkg: PackageJson,
  hookNames: string[]
): Promise<void> {
  const hookName = hookNames.find((name) => pkg.scripts?.[name]);
  if (!hookName) return;
  await runLifecycleHook(packageDir, pkg, hookName);
}

/** Fields from publishConfig that override the corresponding package.json fields */
const PUBLISH_CONFIG_OVERRIDES = [
  "main", "module", "exports", "types", "typings", "browser", "bin",
] as const;

/**
 * Apply publishConfig field overrides to a package.json object.
 * Shallow-merges overridable fields and strips publishConfig from the result.
 * Always returns a new object when publishConfig is present (npm strips it at pack time).
 */
function applyPublishConfig(pkg: PackageJson): PackageJson {
  if (!pkg.publishConfig) return pkg;

  const result = { ...pkg };

  for (const field of PUBLISH_CONFIG_OVERRIDES) {
    if (field in pkg.publishConfig) {
      (result as Record<string, unknown>)[field] = pkg.publishConfig[field];
    }
  }

  delete result.publishConfig;
  return result;
}

/**
 * Rewrite workspace:* and catalog:* protocol versions to actual versions.
 * Only modifies dependencies/devDependencies/peerDependencies.
 * Returns a new object if changes were made, the same object if not.
 */
function rewriteProtocolVersions(pkg: PackageJson): PackageJson {
  let changed = false;
  const result = { ...pkg };
  let catalogs: Catalogs | null = null;
  let catalogsLoaded = false;

  for (const depField of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const) {
    const deps = pkg[depField];
    if (!deps) continue;

    let fieldChanged = false;
    const newDeps = { ...deps };
    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith("workspace:")) {
        const versionPart = version.slice("workspace:".length);
        // workspace:* or workspace:^ or workspace:~ → use the dependency's version from the workspace
        if (versionPart === "*" || versionPart === "^" || versionPart === "~") {
          const depVersion = _cachedWorkspaceVersions?.versions.get(name) ?? pkg.version;
          newDeps[name] = versionPart === "*" ? depVersion : versionPart + depVersion;
        } else {
          // workspace:1.0.0 → 1.0.0
          newDeps[name] = versionPart;
        }
        fieldChanged = true;
        changed = true;
      } else if (version.startsWith("catalog:")) {
        // Lazy-load catalogs only when needed
        if (!catalogsLoaded) {
          catalogs = loadCatalogsFromCache();
          catalogsLoaded = true;
        }
        if (catalogs) {
          const resolved = resolveCatalogVersion(version, name, catalogs);
          if (resolved) {
            newDeps[name] = resolved;
            fieldChanged = true;
            changed = true;
          } else {
            consola.warn(`catalog: specifier for "${name}" could not be resolved — published package.json will contain "${version}" which may cause install failures`);
          }
        } else {
          verbose(`[publish] No pnpm-workspace.yaml found, cannot resolve catalog: for "${name}"`);
        }
      }
    }
    if (fieldChanged) {
      (result as Record<string, unknown>)[depField] = newDeps;
    }
  }

  return changed ? result : pkg;
}

/**
 * Resolve a catalog: specifier to the actual version string.
 * - `catalog:` or `catalog:default` → default catalog
 * - `catalog:<name>` → named catalog
 */
function resolveCatalogVersion(
  specifier: string,
  depName: string,
  catalogs: Catalogs
): string | null {
  const catalogRef = specifier.slice("catalog:".length);

  if (catalogRef === "" || catalogRef === "default") {
    return catalogs.default[depName] ?? null;
  }

  return catalogs.named[catalogRef]?.[depName] ?? null;
}

// Cached workspace root lookup shared by preloadWorkspaceVersions and preloadCatalogs.
let _cachedWorkspaceRoot: { dir: string; root: string | null } | null = null;

async function getWorkspaceRoot(packageDir: string): Promise<string | null> {
  if (_cachedWorkspaceRoot?.dir === packageDir) return _cachedWorkspaceRoot.root;
  const { findWorkspaceRoot } = await import("../utils/workspace.js");
  const root = await findWorkspaceRoot(packageDir);
  _cachedWorkspaceRoot = { dir: packageDir, root };
  return root;
}

// Cached workspace package versions to resolve workspace:* to the dependency's version.
let _cachedWorkspaceVersions: { root: string; versions: Map<string, string> } | null = null;

/**
 * Pre-load workspace package versions so workspace:* resolves to the
 * dependency's own version rather than the publisher's version.
 */
async function preloadWorkspaceVersions(
  pkg: PackageJson,
  packageDir: string
): Promise<void> {
  // Check if any dep uses workspace: protocol
  const hasWorkspace = ([
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const).some((field) => {
    const deps = pkg[field];
    return deps && Object.values(deps).some((v) => v.startsWith("workspace:"));
  });
  if (!hasWorkspace) return;

  const root = await getWorkspaceRoot(packageDir);
  if (!root) {
    _cachedWorkspaceVersions = null;
    return;
  }

  // Reuse cache if same workspace root
  if (_cachedWorkspaceVersions?.root === root) return;

  const { findWorkspacePackages } = await import("../utils/workspace.js");
  const pkgDirs = await findWorkspacePackages(root);
  const versions = new Map<string, string>();

  await Promise.all(
    pkgDirs.map(async (dir) => {
      try {
        const depPkg = JSON.parse(
          await readFile(join(dir, "package.json"), "utf-8")
        ) as PackageJson;
        if (depPkg.name && depPkg.version) {
          versions.set(depPkg.name, depPkg.version);
        }
      } catch {
        // skip unreadable packages
      }
    })
  );

  _cachedWorkspaceVersions = { root, versions };
}

// Cached catalogs per workspace root to avoid re-parsing.
// mtimeMs tracks the workspace config file so changes during watch mode invalidate the cache.
let _cachedCatalogs: { root: string; mtimeMs: number; catalogs: Catalogs } | null = null;

/**
 * Return pre-loaded catalogs from the module-level cache.
 * Must be called after preloadCatalogs() has populated _cachedCatalogs.
 */
function loadCatalogsFromCache(): Catalogs | null {
  return _cachedCatalogs?.catalogs ?? null;
}

/**
 * Pre-load catalog definitions from pnpm-workspace.yaml if any deps use catalog: protocol.
 */
async function preloadCatalogs(
  pkg: PackageJson,
  packageDir: string
): Promise<void> {
  // Check if any dep uses catalog: protocol
  const hasCatalog = (["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const).some(
    (field) => {
      const deps = pkg[field];
      return deps && Object.values(deps).some((v) => v.startsWith("catalog:"));
    }
  );
  if (!hasCatalog) return;

  const root = await getWorkspaceRoot(packageDir);
  if (!root) {
    _cachedCatalogs = null;
    return;
  }

  // Invalidate cache if workspace root changed or config file was modified
  const workspaceFile = join(root, "pnpm-workspace.yaml");
  const mtimeMs = (await stat(workspaceFile).catch(() => null))?.mtimeMs ?? 0;
  if (_cachedCatalogs?.root === root && _cachedCatalogs.mtimeMs === mtimeMs) return;

  const { parseCatalogs } = await import("../utils/workspace.js");
  const catalogs = await parseCatalogs(root);
  _cachedCatalogs = { root, mtimeMs, catalogs };
}
