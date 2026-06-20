import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "../utils/concurrency.js";
import { publish } from "./publisher.js";
import { getStoreEntry } from "./store.js";
import { inject } from "./injector.js";
import { addLink, getConsumers, getLink } from "./tracker.js";
import { detectBuildCommand } from "../utils/build-detect.js";
import { detectPackageManager } from "../utils/pm-detect.js";
import { loadKnarrConfig } from "../utils/config.js";
import type { KnarrConfig } from "../utils/config.js";
import { Timer } from "../utils/timer.js";
import { output } from "../utils/output.js";
import { errorWithSuggestion } from "../utils/errors.js";
import { isDryRun, verbose } from "../utils/logger.js";
import { recordMutation } from "../utils/dry-run.js";
import { consola } from "../utils/console.js";
import type { PackageJson, StoreEntry } from "../types.js";

const consumerLimit = pLimit(4);

export interface PushOptions {
  runScripts?: boolean;
  /** Force copy all files, bypassing hash comparison */
  force?: boolean;
  /** Max historical builds to keep per package */
  historyLimit?: number;
}

export interface PushConsumerResult {
  consumerPath: string;
  status: "updated" | "failed" | "skipped";
  copied: number;
  removed: number;
  skipped: number;
  binLinks: number;
  cacheInvalidations: number;
  reason?: string;
  error?: string;
}

export interface PushSummary {
  name: string;
  version: string;
  buildId: string;
  noChange: boolean;
  skippedReason?: string;
  consumers: number;
  updatedConsumers: number;
  failedConsumers: number;
  skippedConsumers: number;
  copied: number;
  removed: number;
  skipped: number;
  binLinks: number;
  cacheInvalidations: number;
  elapsed: number;
  consumerResults: PushConsumerResult[];
}

/**
 * Publish a package to the store, then inject into all registered consumers.
 * Shared by both `push` and `dev` commands.
 */
export async function doPush(
  packageDir: string,
  options: PushOptions = {}
): Promise<PushSummary> {
  const timer = new Timer();

  // Publish to store
  const result = await publish(packageDir, {
    runScripts: options.runScripts,
    force: options.force,
    historyLimit: options.historyLimit,
  });
  if (result.skipped) {
    const summary = createEmptySummary(result.name, result.version, result.buildId, timer.elapsedMs());
    summary.noChange = true;
    summary.skippedReason = "content unchanged";
    consola.info(
      `No changes to push for ${result.name}@${result.version}` +
        (result.buildId ? ` [${result.buildId}]` : "")
    );
    output(summary);
    return summary;
  }

  // Get the store entry
  const entry = await getStoreEntry(result.name, result.version);
  if (!entry) {
    errorWithSuggestion(
      `Failed to read store entry for ${result.name}@${result.version} after publish`
    );
    const summary = createEmptySummary(result.name, result.version, result.buildId, timer.elapsedMs());
    summary.failedConsumers = 1;
    summary.consumerResults = [
      {
        consumerPath: packageDir,
        status: "failed",
        copied: 0,
        removed: 0,
        skipped: 0,
        binLinks: 0,
        cacheInvalidations: 0,
        error: "store entry missing after publish",
      },
    ];
    return summary;
  }

  return pushStoreEntry(entry, {
    force: options.force,
    timer,
    noConsumersStatus: "published",
  });
}

export interface PushStoreEntryOptions {
  /** Force copy all files, bypassing hash comparison */
  force?: boolean;
  /** Timer to reuse when the store entry push is part of a larger operation */
  timer?: Timer;
  /** Human status when there are no consumers (default: "available") */
  noConsumersStatus?: "published" | "available";
  /** Emit structured output for this push summary (default: true) */
  emitOutput?: boolean;
}

/**
 * Inject an already-published store entry into all registered consumers.
 * Used by rollback so restored history is pushed without republishing source.
 */
export async function pushStoreEntry(
  entry: StoreEntry,
  options: PushStoreEntryOptions = {}
): Promise<PushSummary> {
  const timer = options.timer ?? new Timer();

  // Push to all consumers in parallel
  const consumers = await getConsumers(entry.name);
  if (consumers.length === 0) {
    const status = options.noConsumersStatus ?? "available";
    consola.success(`${entry.name}@${entry.version} ${status} in store`);
    consola.info(
      "No consumers registered yet. Run 'knarr add " + entry.name + "' in a consumer project to start receiving pushes."
    );
    const summary = createEmptySummary(
      entry.name,
      entry.version,
      entry.meta.buildId ?? "",
      timer.elapsedMs()
    );
    if (options.emitOutput !== false) output(summary);
    return summary;
  }

  let totalCopied = 0;
  let totalRemoved = 0;
  let totalSkipped = 0;
  let totalBinLinks = 0;
  let totalCacheInvalidations = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const results = await Promise.all(
    consumers.map((consumerPath) =>
      consumerLimit(async () => {
        const link = await getLink(consumerPath, entry.name);
        if (!link) {
          verbose(
            `[push] No link found for ${entry.name} in ${consumerPath}, skipping`
          );
          return {
            consumerPath,
            status: "skipped",
            copied: 0,
            removed: 0,
            skipped: 0,
            binLinks: 0,
            cacheInvalidations: 0,
            reason: "not linked in consumer state",
          } satisfies PushConsumerResult;
        }

        try {
          const injectResult = await inject(
            entry,
            consumerPath,
            link.packageManager,
            { force: options.force }
          );

          // Always update state.json so the Vite plugin detects the push
          // and triggers a full reload. Even if no files were copied (all
          // skipped as unchanged), the user expects a refresh after `knarr push`.
          await addLink(consumerPath, entry.name, {
            ...link,
            contentHash: entry.meta.contentHash,
            linkedAt: new Date().toISOString(),
            buildId: entry.meta.buildId ?? "",
          });

          return {
            consumerPath,
            status: "updated",
            copied: injectResult.copied,
            removed: injectResult.removed,
            skipped: injectResult.skipped,
            binLinks: injectResult.binLinks,
            cacheInvalidations: injectResult.cacheInvalidations,
          } satisfies PushConsumerResult;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          consola.warn(
            `Failed to push to ${consumerPath}: ${message}`
          );
          return {
            consumerPath,
            status: "failed",
            copied: 0,
            removed: 0,
            skipped: 0,
            binLinks: 0,
            cacheInvalidations: 0,
            error: message,
          } satisfies PushConsumerResult;
        }
      })
    )
  );

  for (const r of results) {
    if (r.status === "updated") {
      totalCopied += r.copied;
      totalRemoved += r.removed;
      totalSkipped += r.skipped;
      totalBinLinks += r.binLinks;
      totalCacheInvalidations += r.cacheInvalidations;
      updatedCount++;
    } else if (r.status === "skipped") {
      skippedCount++;
    } else {
      failedCount++;
    }
  }

  const buildId = entry.meta.buildId ?? "";
  const buildTag = buildId ? ` [${buildId}]` : "";
  const detailParts = [
    `${totalCopied} copied`,
    `${totalRemoved} removed`,
    `${totalSkipped} unchanged`,
  ];
  if (totalBinLinks > 0) detailParts.push(`${totalBinLinks} bin links`);
  if (totalCacheInvalidations > 0) {
    detailParts.push(`${totalCacheInvalidations} cache invalidations`);
  }
  if (skippedCount > 0) detailParts.push(`${skippedCount} consumer(s) skipped`);
  if (failedCount > 0) detailParts.push(`${failedCount} failed`);

  const consumerLabel =
    failedCount > 0 || skippedCount > 0
      ? `${updatedCount}/${consumers.length} consumer(s)`
      : `${updatedCount} consumer(s)`;
  const message =
    `Pushed ${entry.name}@${entry.version}${buildTag} to ${consumerLabel} ` +
    `in ${timer.elapsed()} (${detailParts.join(", ")})`;

  if (failedCount > 0) {
    consola.warn(message);
  } else {
    consola.success(message);
  }

  const summary: PushSummary = {
    name: entry.name,
    version: entry.version,
    buildId,
    noChange: false,
    consumers: consumers.length,
    updatedConsumers: updatedCount,
    failedConsumers: failedCount,
    skippedConsumers: skippedCount,
    copied: totalCopied,
    removed: totalRemoved,
    skipped: totalSkipped,
    binLinks: totalBinLinks,
    cacheInvalidations: totalCacheInvalidations,
    elapsed: timer.elapsedMs(),
    consumerResults: results,
  };

  if (options.emitOutput !== false) output(summary);
  return summary;
}

function createEmptySummary(
  name: string,
  version: string,
  buildId: string,
  elapsed: number
): PushSummary {
  return {
    name,
    version,
    buildId,
    noChange: false,
    consumers: 0,
    updatedConsumers: 0,
    failedConsumers: 0,
    skippedConsumers: 0,
    copied: 0,
    removed: 0,
    skipped: 0,
    binLinks: 0,
    cacheInvalidations: 0,
    elapsed,
    consumerResults: [],
  };
}

export interface WatchConfig {
  buildCmd?: string;
  patterns?: string[];
}

/** Common CLI args shared by push --watch and dev */
export interface WatchArgs {
  build?: string;
  "skip-build"?: boolean;
  debounce?: string;
  cooldown?: string;
  notify?: boolean;
  "no-cascade"?: boolean;
}

/** Parse a string CLI arg as an integer, returning undefined if invalid */
function parseMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Start watch mode: resolve config, start watcher, wait for signal.
 * Shared by both `push --watch` and `dev` commands.
 * Merge priority: CLI args > package.json#knarr > auto-detection.
 */
export async function startWatchMode(
  packageDir: string,
  args: WatchArgs,
  push: () => Promise<unknown>
): Promise<void> {
  const { startWatcher } = await import("./watcher.js");
  const config = await loadKnarrConfig(packageDir);
  const { buildCmd, patterns } = await resolveWatchConfig(packageDir, args, config);

  const notify = args.notify ?? config.notify ?? false;
  const watcher = await startWatcher(
    packageDir,
    {
      patterns,
      buildCmd,
      debounce: parseMs(args.debounce) ?? config.debounce,
      cooldown: parseMs(args.cooldown) ?? config.cooldown,
      notify,
    },
    async () => {
      await push();
    }
  );

  await new Promise<void>((resolve) => {
    const cleanup = async () => {
      consola.info("Stopping watcher...");
      await watcher.close();
      resolve();
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  });
}

/**
 * Run the watch-mode build command once before the initial publish/push.
 * Returns false when a configured build fails, so callers can skip publishing
 * stale output while still entering watch mode.
 */
export async function runInitialWatchBuild(
  packageDir: string,
  args: WatchArgs,
  config?: KnarrConfig
): Promise<boolean> {
  const resolvedConfig = config ?? await loadKnarrConfig(packageDir);
  const { buildCmd } = await resolveWatchConfig(packageDir, args, resolvedConfig);
  if (!buildCmd) return true;

  if (isDryRun()) {
    recordMutation({ type: "command-skip", path: packageDir, detail: buildCmd });
    return true;
  }

  const { runBuildCommand } = await import("./watcher.js");
  const success = await runBuildCommand(buildCmd, packageDir);
  if (!success) {
    consola.warn("Initial build failed; skipping initial push. Watch mode will continue.");
  }
  return success;
}

/**
 * Run initial watch builds for all publishable workspace packages in
 * dependency-first order.
 */
export async function runInitialWorkspaceWatchBuilds(
  startDir: string,
  args: WatchArgs
): Promise<boolean> {
  const {
    buildWorkspaceGraph,
    filterPublishableWorkspaceGraph,
  } = await import("../utils/workspace.js");
  const { topoSort, CycleError } = await import("../utils/topo-sort.js");

  const discovered = await buildWorkspaceGraph(startDir);
  const graph = filterPublishableWorkspaceGraph(discovered);
  if (graph.packages.length === 0) return true;

  let ordered: string[];
  try {
    ordered = topoSort(graph.adjacency);
  } catch (err) {
    if (err instanceof CycleError) {
      consola.error(`Cannot build workspace before watch: ${err.message}`);
      return false;
    }
    throw err;
  }

  const nameToDir = new Map(graph.packages.map((p) => [p.name, p.dir]));
  let ok = true;
  for (const name of ordered) {
    const dir = nameToDir.get(name);
    if (!dir) continue;
    const success = await runInitialWatchBuild(dir, args);
    ok &&= success;
  }
  return ok;
}

/**
 * Resolve build command and watch patterns from CLI args, config, and auto-detection.
 * Merge priority: CLI args > package.json#knarr > auto-detection.
 */
export async function resolveWatchConfig(
  packageDir: string,
  args: { build?: string; "skip-build"?: boolean },
  config?: KnarrConfig
): Promise<WatchConfig> {
  let buildCmd: string | undefined = args.build;
  let patterns: string[] | undefined = config?.watchPatterns;

  if (args.build) {
    // Explicit CLI: use as-is
  } else if (args["skip-build"]) {
    // Explicitly no build
  } else if (config?.buildCmd) {
    // From package.json#knarr
    buildCmd = config.buildCmd;
    consola.info(`Using build command from config: ${buildCmd}`);
  } else {
    // Auto-detect from package.json scripts
    const pm = await detectPackageManager(packageDir);
    const detected = await detectBuildCommand(packageDir, pm);
    if (detected) {
      buildCmd = detected;
      consola.info(`Auto-detected build command: ${detected}`);
    }
  }

  if (buildCmd && !patterns) {
    // With a build command: watch source directories that actually exist.
    // Avoids infinite loop where build output (dist/) triggers another build.
    const { exists } = await import("../utils/fs.js");
    const candidates = ["src", "lib", "source", "app", "pages", "components"];
    const existing = (await Promise.all(
      candidates.map(async (dir) => ({
        dir,
        exists: await exists(join(packageDir, dir)),
      }))
    )).filter((c) => c.exists).map((c) => c.dir);
    patterns = existing.length > 0 ? existing : ["src", "lib"];
    verbose(`[watch] Using source patterns with build command: ${patterns.join(", ")}`);
  } else if (buildCmd && patterns) {
    verbose(`[watch] Using configured watch patterns with build command: ${patterns.join(", ")}`);
  } else {
    // Without a build command: watch the package.json `files` field (typically dist/)
    consola.info("No build command detected — watching output directories directly");
    try {
      const pkg = JSON.parse(
        await readFile(join(packageDir, "package.json"), "utf-8")
      ) as PackageJson;
      if (pkg.files && pkg.files.length > 0) {
        patterns = pkg.files;
        consola.info(`Watching from package.json "files": ${patterns.join(", ")}`);
      } else {
        consola.warn(
          `No "files" field in package.json — falling back to watching src/ and lib/. ` +
          `Add a "files" field or use --build to specify a build command.`
        );
      }
    } catch (err) {
      verbose(
        `[watch] Could not read package.json: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { buildCmd, patterns };
}

/**
 * Start watch mode for all workspace packages.
 * When cascade is enabled (default), rebuilding a package automatically
 * triggers rebuilds of its dependents in the workspace.
 */
export async function startMultiWatchMode(
  startDir: string,
  args: WatchArgs,
  pushOptions: PushOptions
): Promise<void> {
  const cascade = !args["no-cascade"];
  const { WatchOrchestrator } = await import("./watch-orchestrator.js");

  const orchestrator = new WatchOrchestrator(cascade);
  await orchestrator.start(startDir, args, pushOptions);
}
