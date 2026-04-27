import pLimit from "../utils/concurrency.js";
import { consola } from "../utils/console.js";
import { verbose } from "../utils/logger.js";
import { loadKnarrConfig } from "../utils/config.js";
import { doPush, resolveWatchConfig } from "./push-engine.js";
import type { WatchArgs, PushOptions } from "./push-engine.js";

type PackageState = "idle" | "building" | "queued";

interface PackageEntry {
  dir: string;
  buildCmd?: string;
  state: PackageState;
  watcher: { close: () => Promise<void> };
}

const cascadeLimit = pLimit(2);

/**
 * Orchestrates watch mode for all workspace packages with optional
 * cascading rebuilds. When a package is pushed, its dependents in
 * the workspace are automatically rebuilt and pushed.
 *
 * State machine per package prevents infinite loops:
 *   idle → building → idle (normal)
 *   building + trigger → queued → building (coalesced)
 *   queued + trigger → queued (no-op)
 */
export class WatchOrchestrator {
  private packages = new Map<string, PackageEntry>();
  private dependents = new Map<string, Set<string>>();
  private cascade: boolean;
  private pushOptions: PushOptions = {};

  constructor(cascade: boolean) {
    this.cascade = cascade;
  }

  async start(
    startDir: string,
    args: WatchArgs,
    pushOptions: PushOptions
  ): Promise<void> {
    this.pushOptions = pushOptions;

    const { buildWorkspaceGraph, buildReverseAdjacency } = await import(
      "../utils/workspace.js"
    );
    const { topoSort, CycleError } = await import("../utils/topo-sort.js");
    const { startWatcher } = await import("./watcher.js");

    const graph = await buildWorkspaceGraph(startDir);
    if (graph.packages.length === 0) {
      consola.warn("No workspace packages found");
      return;
    }

    let ordered: string[];
    try {
      ordered = topoSort(graph.adjacency);
    } catch (err) {
      if (err instanceof CycleError) {
        consola.error(`Cannot watch: ${err.message}`);
        return;
      }
      throw err;
    }

    if (this.cascade) {
      this.dependents = buildReverseAdjacency(graph.adjacency);
      consola.info("Cascade mode enabled");
    }

    const nameToDir = new Map(graph.packages.map((p) => [p.name, p.dir]));

    for (const name of ordered) {
      const dir = nameToDir.get(name);
      if (!dir) continue;

      const config = await loadKnarrConfig(dir);
      const { buildCmd, patterns } = await resolveWatchConfig(dir, args, config);
      const notify = args.notify ?? config.notify ?? false;

      const wrappedOnChange = async () => {
        await doPush(dir, pushOptions);
        await this.onPackagePushed(name);
      };

      const parseMs = (v: string | undefined) => {
        if (!v) return undefined;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : undefined;
      };

      const watcher = await startWatcher(
        dir,
        {
          patterns,
          buildCmd,
          debounce: parseMs(args.debounce) ?? config.debounce,
          cooldown: parseMs(args.cooldown) ?? config.cooldown,
          notify,
        },
        wrappedOnChange
      );

      this.packages.set(name, { dir, buildCmd, state: "idle", watcher });
    }

    consola.info(`Watching ${this.packages.size} workspace packages`);

    await new Promise<void>((resolve) => {
      const cleanup = async () => {
        consola.info("Stopping watchers...");
        await this.close();
        resolve();
      };
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
    });
  }

  private async onPackagePushed(name: string): Promise<void> {
    if (!this.cascade) return;

    const deps = this.dependents.get(name);
    if (!deps || deps.size === 0) return;

    verbose(`[cascade] ${name} pushed, triggering dependents: ${[...deps].join(", ")}`);

    const tasks = [...deps].map((depName) =>
      cascadeLimit(() => this.requestRebuild(depName))
    );
    await Promise.all(tasks);
  }

  private async requestRebuild(name: string): Promise<void> {
    const entry = this.packages.get(name);
    if (!entry) return;

    if (entry.state === "queued") {
      verbose(`[cascade] ${name} already queued, skipping`);
      return;
    }

    if (entry.state === "building") {
      verbose(`[cascade] ${name} is building, marking as queued`);
      entry.state = "queued";
      return;
    }

    // idle → building
    entry.state = "building";
    verbose(`[cascade] Rebuilding ${name}`);

    try {
      if (entry.buildCmd) {
        const { runBuildCommand } = await import("./watcher.js");
        const success = await runBuildCommand(entry.buildCmd, entry.dir);
        if (!success) {
          consola.warn(`[cascade] Build failed for ${name}, skipping dependents`);
          entry.state = "idle";
          return;
        }
      }

      await doPush(entry.dir, this.pushOptions);
      await this.onPackagePushed(name);
    } catch (err) {
      consola.warn(
        `[cascade] Push failed for ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // State may have been set to "queued" by a concurrent requestRebuild call
      // while async build/push was in progress — check before resetting
      const wasQueued = (entry.state as PackageState) === "queued";
      entry.state = "idle";

      if (wasQueued) {
        // Re-run since changes arrived during build
        await this.requestRebuild(name);
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.packages.values()].map((p) => p.watcher.close())
    );
    this.packages.clear();
  }
}
