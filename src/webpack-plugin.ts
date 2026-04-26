import { join, normalize } from "node:path";
import { readFileSync } from "node:fs";

// Loose interfaces to avoid importing webpack or rspack
interface Compiler {
  options: {
    snapshot?: {
      managedPaths?: (string | RegExp)[];
    };
    context?: string;
  };
  hooks: {
    afterEnvironment: { tap(name: string, fn: () => void): void };
    watchRun: { tapPromise(name: string, fn: (compiler: Compiler) => Promise<void>): void };
    afterCompile: { tapPromise(name: string, fn: (compilation: Compilation) => Promise<void>): void };
    watchClose: { tap(name: string, fn: () => void): void };
  };
  watching?: {
    invalidate(cb?: () => void): void;
  };
}

interface Compilation {
  contextDependencies: Set<string>;
}

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

export interface KnarrWebpackPluginOptions {
  /** Project root (default: compiler.options.context or cwd) */
  root?: string;
}

/**
 * Webpack/rspack plugin for knarr.
 *
 * - Excludes linked packages from webpack's snapshot cache (managedPaths)
 * - Watches .knarr/state.json and linked package directories
 * - Invalidates the compiler on changes to trigger a rebuild
 * - Works with webpack 5 and rspack (uses loose typing, no webpack import)
 */
export class KnarrWebpackPlugin {
  private options: KnarrWebpackPluginOptions;

  constructor(options: KnarrWebpackPluginOptions = {}) {
    this.options = options;
  }

  apply(compiler: Compiler): void {
    const root = this.options.root ?? compiler.options.context ?? process.cwd();
    const stateFile = normalize(join(root, ".knarr", "state.json"));
    const nodeModulesDir = join(root, "node_modules");

    let watcher: { close: () => Promise<void> } | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStateContent = "";

    const watchedPackages = new Set<string>();

    const invalidate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (compiler.watching) {
          compiler.watching.invalidate();
        }
      }, 200);
    };

    const syncPackages = () => {
      let changed = false;
      for (const pkg of readLinkedPackagesSync(stateFile)) {
        if (!watchedPackages.has(pkg)) {
          watchedPackages.add(pkg);
          changed = true;
        }
      }
      return changed;
    };

    // Exclude linked packages from webpack's snapshot managedPaths
    // so webpack doesn't cache them as immutable node_modules
    compiler.hooks.afterEnvironment.tap("KnarrWebpackPlugin", () => {
      syncPackages();
      if (watchedPackages.size === 0) return;

      const snapshot = compiler.options.snapshot ??= {};
      const managedPaths = snapshot.managedPaths ??= [];

      // Build a regex that matches node_modules but excludes linked packages
      const escaped = [...watchedPackages]
        .sort((a, b) => b.length - a.length)
        .map((p) => p.replace(/[/\\.*+?^${}()|[\]]/g, "\\$&"))
        .join("|");

      // Remove the default managed paths that would match our linked packages
      // and add a more specific one that excludes them
      const excludeRegex = new RegExp(
        `node_modules[\\\\/](?!(?:${escaped})(?:[\\\\/]|$))`
      );

      // Replace any broad node_modules matcher with our more specific one
      const filtered = managedPaths.filter((p) => {
        if (typeof p === "string") return !p.includes("node_modules");
        return !p.source?.includes("node_modules");
      });
      filtered.push(excludeRegex);
      snapshot.managedPaths = filtered;
    });

    // Start watching state.json and linked package dirs
    compiler.hooks.watchRun.tapPromise(
      "KnarrWebpackPlugin",
      async () => {
        if (watcher) return;

        const usePolling = !!process.versions?.webcontainer;

        if (usePolling) {
          // WebContainer polling fallback
          try {
            lastStateContent = readFileSync(stateFile, "utf-8");
          } catch {
            // state.json doesn't exist yet
          }

          pollTimer = setInterval(() => {
            try {
              const content = readFileSync(stateFile, "utf-8");
              if (lastStateContent && content !== lastStateContent) {
                lastStateContent = content;
                syncPackages();
                invalidate();
              }
              if (!lastStateContent) lastStateContent = content;
            } catch {
              // state.json doesn't exist yet
            }
          }, 1000);
        }

        const { watch } = await import("chokidar");
        const watchPaths = [stateFile];
        for (const pkg of watchedPackages) {
          watchPaths.push(join(nodeModulesDir, pkg));
        }

        const chokidarWatcher = watch(watchPaths, {
          ignoreInitial: true,
          ignored: [/[/\\]\.git[/\\]/],
          usePolling,
          ...(usePolling && { interval: 1000 }),
        });

        chokidarWatcher.on("change", (changedPath) => {
          const normalized = normalize(changedPath);
          if (normalized === stateFile) {
            const changed = syncPackages();
            if (changed) {
              // New packages linked — add their dirs to the watcher
              for (const pkg of watchedPackages) {
                chokidarWatcher.add(join(nodeModulesDir, pkg));
              }
            }
          }
          invalidate();
        });

        chokidarWatcher.on("add", () => invalidate());
        chokidarWatcher.on("unlink", () => invalidate());

        watcher = {
          close: () => chokidarWatcher.close(),
        };
      }
    );

    // Add linked package directories as context dependencies so webpack
    // watches them for changes (belt-and-suspenders with chokidar)
    compiler.hooks.afterCompile.tapPromise(
      "KnarrWebpackPlugin",
      async (compilation) => {
        for (const pkg of watchedPackages) {
          compilation.contextDependencies.add(join(nodeModulesDir, pkg));
        }
      }
    );

    // Cleanup on watch close
    compiler.hooks.watchClose.tap("KnarrWebpackPlugin", () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    });
  }
}

export type KNARRWebpackPluginOptions = KnarrWebpackPluginOptions;
export type PlunkWebpackPluginOptions = KnarrWebpackPluginOptions;
export const KNARRWebpackPlugin = KnarrWebpackPlugin;
export const PlunkWebpackPlugin = KnarrWebpackPlugin;

export default KnarrWebpackPlugin;
