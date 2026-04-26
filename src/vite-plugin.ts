import { join, normalize } from "node:path";
import { readFileSync } from "node:fs";
import type { Plugin, UserConfig } from "vite";

interface KnarrState {
  links?: Record<string, unknown>;
}

/** Synchronously read linked package names from state.json */
function readLinkedPackagesSync(stateFile: string): string[] {
  try {
    const content = readFileSync(stateFile, "utf-8");
    const state = JSON.parse(content) as KnarrState;
    return Object.keys(state.links ?? {});
  } catch {
    return [];
  }
}

export default function knarrPlugin(): Plugin {
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
        result.optimizeDeps = { exclude: newExclude };
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
      console.log(`[knarr] Watching state file: ${knarrStateFile}`);
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
          (server.watcher as any)._userIgnored = undefined;

          // Now add() calls actually register with chokidar
          for (const pkg of watchedPackages) {
            const pkgPath = join(nodeModulesDir, pkg);
            server.watcher.add(pkgPath);
          console.log(`[knarr] Added watcher for package: ${pkgPath}`);
          }
        }
      }

      /** Restart the dev server to pick up changes */
      async function restartServer(source: string) {
        if (isRestarting) {
          pendingRestart = true;
          console.log(`[knarr] Restart already in progress, queued: ${source}`);
          return;
        }
        isRestarting = true;

        syncPackageWatchers();

        console.log(`[knarr] ${source}, restarting server...`);

        try {
          await server.restart();
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
          restartServer(source);
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
      console.log(`[knarr] Added watcher for: ${knarrStateFile}`);

      // Initial sync
      syncPackageWatchers();

      // Watch for changes to state.json and linked package files.
      // state.json with new package → server.restart() (config needs re-eval).
      // Linked package file change → invalidate module graph + full-reload
      // (server.restart() drops the HMR WebSocket and doesn't reliably
      // trigger a browser reload).
      server.watcher.on("change", async (changedPath: string) => {
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

        pollTimer = setInterval(async () => {
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
