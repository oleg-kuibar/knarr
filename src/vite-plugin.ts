import { dirname, extname, join, normalize } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import type { Plugin, UserConfig } from "vite";
import { objectField, parseJsonObject } from "./utils/json.js";
import type { JsonObject } from "./utils/json.js";
import { validatePackageName } from "./utils/validators.js";

/** Synchronously read linked package names from state.json */
function readLinkedPackagesSync(stateFile: string): string[] {
  try {
    const content = readFileSync(stateFile, "utf-8");
    const links = objectField(parseJsonObject(content, stateFile), "links");
    return links ? Object.keys(links) : [];
  } catch {
    return [];
  }
}

function readManifestSync(dir: string): JsonObject | undefined {
  try {
    return parseJsonObject(readFileSync(join(dir, "package.json"), "utf-8"), dir);
  } catch {
    return undefined;
  }
}

function findInstalledPackageDir(fromDir: string, name: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const ENTRY_CONDITIONS = ["import", "module", "browser", "default", "require"];
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx"]);

function conditionalTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const conditions = value as JsonObject;
  for (const condition of ENTRY_CONDITIONS) {
    const target = conditionalTarget(conditions[condition]);
    if (target) return target;
  }
  return undefined;
}

function mainEntry(manifest: JsonObject): string | undefined {
  const exportsField = manifest["exports"];
  if (exportsField !== undefined) {
    const isSubpathMap =
      typeof exportsField === "object" &&
      exportsField !== null &&
      !Array.isArray(exportsField) &&
      Object.keys(exportsField).some((key) => key.startsWith("."));
    return conditionalTarget(isSubpathMap ? (exportsField as JsonObject)["."] : exportsField);
  }
  for (const field of ["module", "main"]) {
    const value = manifest[field];
    if (typeof value === "string") return value;
  }
  return "index.js";
}

function hasJsEntry(packageDir: string, manifest: JsonObject): boolean {
  const entry = mainEntry(manifest);
  if (!entry) return false;
  const ext = extname(entry);
  const entryPath = join(packageDir, entry);
  if (ext === "") return existsSync(`${entryPath}.js`) || existsSync(join(entryPath, "index.js"));
  return JS_EXTENSIONS.has(ext) && existsSync(entryPath);
}

/**
 * `linked > dep` entries for optimizeDeps.include. Excluding a linked package also
 * stops Vite from scanning its imports, so its CommonJS dependencies would reach the
 * browser unconverted.
 */
function linkedDependencyIncludes(nodeModulesDir: string, linkedPackages: string[]): string[] {
  const linked = new Set(linkedPackages);
  const includes: string[] = [];
  for (const pkg of linkedPackages) {
    let pkgDir: string;
    try {
      pkgDir = realpathSync(join(nodeModulesDir, pkg));
    } catch {
      continue;
    }
    const deps = objectField(readManifestSync(pkgDir) ?? {}, "dependencies");
    for (const dep of Object.keys(deps ?? {})) {
      if (linked.has(dep)) continue;
      try {
        validatePackageName(dep);
      } catch {
        continue;
      }
      const depDir = findInstalledPackageDir(pkgDir, dep);
      const depManifest = depDir && readManifestSync(depDir);
      if (depDir && depManifest && hasJsEntry(depDir, depManifest)) {
        includes.push(`${pkg} > ${dep}`);
      }
    }
  }
  return includes;
}

export interface KnarrVitePluginOptions {
  /** Log watcher setup details (default: false, or true when KNARR_VERBOSE=1). */
  verbose?: boolean;
}

export default function knarrPlugin(options: KnarrVitePluginOptions = {}): Plugin {
  const verbose = options.verbose ?? process.env.KNARR_VERBOSE === "1";
  /** Setup and bookkeeping details: only with verbose. User-facing events use console.log. */
  const debug = (msg: string) => {
    if (verbose) console.log(msg);
  };
  let knarrStateFile: string;
  let nodeModulesDir: string;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  return {
    name: "vite-plugin-knarr",
    apply: "serve",

    // Exclude linked packages from pre-bundling so Vite serves them
    // directly from node_modules. This ensures fresh code after push.
    config(config, { command }) {
      if (command !== "serve") return;

      const root = config.root ?? process.cwd();
      const stateFile = join(root, ".knarr", "state.json");
      const linkedPackages = readLinkedPackagesSync(stateFile);

      const result: UserConfig = {};

      if (linkedPackages.length > 0) {
        // Merge with existing optimizeDeps.exclude
        const existingExclude = config.optimizeDeps?.exclude ?? [];
        const newExclude = [
          ...existingExclude,
          ...linkedPackages.filter((pkg) => !existingExclude.includes(pkg)),
        ];

        console.log(`[knarr] Excluding from pre-bundling: ${newExclude.join(", ")}`);

        const existingInclude = config.optimizeDeps?.include ?? [];
        const newInclude = linkedDependencyIncludes(join(root, "node_modules"), linkedPackages).filter(
          (entry) => !existingInclude.includes(entry)
        );
        debug(`[knarr] Pre-bundling dependencies of linked packages: ${newInclude.join(", ") || "none"}`);
        result.optimizeDeps = { exclude: newExclude, include: newInclude };
      }

      // WebContainers don't emit native filesystem events, so chokidar
      // never fires. Enable polling for file-watching to work.
      const isWebContainer = !!process.versions?.webcontainer;
      if (isWebContainer && !config.server?.watch?.usePolling) {
        result.server = {
          watch: { usePolling: true, interval: 1000 },
        };
        console.log("[knarr] WebContainer detected, enabling filesystem polling");
      }

      if (Object.keys(result).length === 0) return;

      return result satisfies UserConfig;
    },

    configResolved(config) {
      nodeModulesDir = join(config.root, "node_modules");
      knarrStateFile = normalize(join(config.root, ".knarr", "state.json"));
      debug(`[knarr] Watching state file: ${knarrStateFile}`);
    },

    configureServer(server) {
      // Mutable set of watched packages - updated whenever state.json changes
      const watchedPackages = new Set<string>();
      let isRestarting = false;
      let pendingRestart = false;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let reloadTimer: ReturnType<typeof setTimeout> | null = null;

      /** Re-read state.json and add watchers for any new linked packages */
      function syncPackageWatchers() {
        let added = false;
        for (const pkg of readLinkedPackagesSync(knarrStateFile)) {
          if (!watchedPackages.has(pkg)) {
            watchedPackages.add(pkg);
            added = true;
          }
        }

        if (added && watchedPackages.size > 0) {
          // Vite hardcodes **/node_modules/** in its chokidar ignored list.
          // Override with a regex that allows our linked packages through.
          // This is the standard workaround from vitejs/vite#8619.
          const escaped = [...watchedPackages]
            .sort((a, b) => b.length - a.length)
            .map(p => p.replace(/[/\\.*+?^${}()|[\]]/g, "\\$&"))
            .join("|");

          server.watcher.options = {
            ...server.watcher.options,
            ignored: [
              new RegExp(`node_modules\\/(?!(?:${escaped})(?:\\/|$)).*`),
              /[/\\]\.git[/\\]/,
              /[/\\]test-results[/\\]/,
            ],
          };
          // Force chokidar to recompute its ignored filter.
          // Chokidar lazily caches the result of its `_userIgnored` function;
          // clearing it forces re-evaluation with the updated `ignored` list.
          // Workaround for vitejs/vite#8619. Fragile - breaks if chokidar
          // renames this internal field.
          (server.watcher as unknown as { _userIgnored?: unknown })._userIgnored = undefined;

          // Now add() calls actually register with chokidar
          for (const pkg of watchedPackages) {
            const pkgPath = join(nodeModulesDir, pkg);
            server.watcher.add(pkgPath);
          debug(`[knarr] Added watcher for package: ${pkgPath}`);
          }
        }
      }

      /** Restart the dev server to pick up changes */
      async function restartServer(source: string) {
        if (isRestarting) {
          pendingRestart = true;
          debug(`[knarr] Restart already in progress, queued: ${source}`);
          return;
        }
        isRestarting = true;

        syncPackageWatchers();

        console.log(`[knarr] ${source}, restarting server...`);

        try {
          await server.restart();
        } catch (err) {
          // Never let a failed restart become an unhandled rejection: Node would
          // terminate the developer's dev server.
          console.error(`[knarr] Dev server restart failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          isRestarting = false;
          if (pendingRestart) {
            pendingRestart = false;
            await restartServer("Queued change detected");
          }
        }
      }

      /** Debounced restart for state.json changes (new packages linked) */
      function scheduleRestart(source: string) {
        if (debounceTimer) return;  // already scheduled, don't reset
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void restartServer(source); // handles its own errors
        }, 1500);
      }

      /** Send a debounced full-reload to the browser */
      function scheduleReload() {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          console.log("[knarr] Linked package updated, reloading");
          server.hot.send({ type: "full-reload", path: "*" });
        }, 200);
      }

      /** Invalidate changed module and send debounced full-reload */
      function invalidateAndReload(changedPath: string) {
        const normalized = normalize(changedPath);
        const mods = server.moduleGraph.getModulesByFile(normalized);
        if (mods) {
          mods.forEach((m) => server.moduleGraph.invalidateModule(m));
        }
        scheduleReload();
      }

      /** Invalidate all cached modules for linked packages (polling fallback) */
      function invalidateLinkedModules() {
        for (const [url, mod] of server.moduleGraph.urlToModuleMap) {
          for (const pkg of watchedPackages) {
            if (url.includes(pkg)) {
              server.moduleGraph.invalidateModule(mod);
              break;
            }
          }
        }
        scheduleReload();
      }

      server.watcher.add(knarrStateFile);
      debug(`[knarr] Added watcher for: ${knarrStateFile}`);

      // Initial sync
      syncPackageWatchers();

      // Watch for changes to state.json and linked package files.
      // state.json with new package → server.restart() (config needs re-eval).
      // Linked package file change → invalidate module graph + full-reload
      // (server.restart() drops the HMR WebSocket and doesn't reliably
      // trigger a browser reload).
      server.watcher.on("change", (changedPath: string) => {
        const normalizedChanged = normalize(changedPath);

        if (normalizedChanged === knarrStateFile) {
          const currentPackages = readLinkedPackagesSync(knarrStateFile);
          const hasNew = currentPackages.some((pkg) => !watchedPackages.has(pkg));
          if (hasNew) {
            scheduleRestart("New package linked");
          } else {
            invalidateLinkedModules();
          }
          return;
        }

        const isLinkedPackage = [...watchedPackages].some((pkg) =>
          normalizedChanged.includes(normalize(join(nodeModulesDir, pkg)))
        );
        if (isLinkedPackage) {
          invalidateAndReload(changedPath);
        }
      });

      // `knarr push` may copy new files that trigger chokidar `add` (not
      // `change`) events. Handle them with the same invalidate+reload logic.
      server.watcher.on("add", (addedPath: string) => {
        const normalizedAdded = normalize(addedPath);
        const isLinkedPackage = [...watchedPackages].some((pkg) =>
          normalizedAdded.includes(normalize(join(nodeModulesDir, pkg)))
        );
        if (isLinkedPackage) {
          invalidateAndReload(addedPath);
        }
      });

      // Fallback detection for WebContainers: poll state.json directly.
      if (process.versions?.webcontainer) {
        if (pollTimer) clearInterval(pollTimer);

        let lastStateContent = "";
        try {
          lastStateContent = readFileSync(knarrStateFile, "utf-8");
        } catch {
          // state.json doesn't exist yet
        }

        pollTimer = setInterval(() => {
          try {
              const content = readFileSync(knarrStateFile, "utf-8");
            if (lastStateContent && content !== lastStateContent) {
              lastStateContent = content;
              const currentPackages = readLinkedPackagesSync(knarrStateFile);
              const hasNew = currentPackages.some(
                (pkg) => !watchedPackages.has(pkg)
              );
              if (hasNew) {
                scheduleRestart("New package linked (polling fallback)");
              } else {
                invalidateLinkedModules();
              }
            }
            if (!lastStateContent) lastStateContent = content;
          } catch {
            // state.json doesn't exist yet
          }
        }, 1000);

        console.log("[knarr] WebContainer polling fallback active (1s interval)");
      }

      server.httpServer?.on('close', () => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
      });
    },
  };
}
