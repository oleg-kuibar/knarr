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
import { verbose } from "../utils/logger.js";
import { consola } from "../utils/console.js";
import type { PackageJson } from "../types.js";

const consumerLimit = pLimit(4);

export interface PushOptions {
  runScripts?: boolean;
  /** Force copy all files, bypassing hash comparison */
  force?: boolean;
  /** Max historical builds to keep per package */
  historyLimit?: number;
}

/**
 * Publish a package to the store, then inject into all registered consumers.
 * Shared by both `push` and `dev` commands.
 */
export async function doPush(
  packageDir: string,
  options: PushOptions = {}
): Promise<void> {
  const timer = new Timer();

  // Publish to store
  const result = await publish(packageDir, {
    runScripts: options.runScripts,
    force: options.force,
    historyLimit: options.historyLimit,
  });
  if (result.skipped) {
    consola.info("No changes to push");
    return;
  }

  // Get the store entry
  const entry = await getStoreEntry(result.name, result.version);
  if (!entry) {
    errorWithSuggestion(
      `Failed to read store entry for ${result.name}@${result.version} after publish`
    );
    return;
  }

  // Push to all consumers in parallel
  const consumers = await getConsumers(result.name);
  if (consumers.length === 0) {
    consola.success(
      `Published ${result.name}@${result.version} to store`
    );
    consola.info(
      "No consumers registered yet. Run 'knarr add " + result.name + "' in a consumer project to start receiving pushes."
    );
    output({
      name: result.name,
      version: result.version,
      buildId: result.buildId,
      consumers: 0,
      failedConsumers: 0,
      copied: 0,
      skipped: 0,
      elapsed: timer.elapsedMs(),
    });
    return;
  }

  let totalCopied = 0;
  let totalSkipped = 0;
  let pushCount = 0;
  let failedCount = 0;

  const results = await Promise.all(
    consumers.map((consumerPath) =>
      consumerLimit(async () => {
        const link = await getLink(consumerPath, result.name);
        if (!link) {
          verbose(
            `[push] No link found for ${result.name} in ${consumerPath}, skipping`
          );
          return null;
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
          await addLink(consumerPath, result.name, {
            ...link,
            contentHash: entry.meta.contentHash,
            linkedAt: new Date().toISOString(),
            buildId: entry.meta.buildId ?? "",
          });

          return injectResult;
        } catch (err) {
          consola.warn(
            `Failed to push to ${consumerPath}: ${err instanceof Error ? err.message : String(err)}`
          );
          return null;
        }
      })
    )
  );

  for (const r of results) {
    if (r) {
      totalCopied += r.copied;
      totalSkipped += r.skipped;
      pushCount++;
    } else {
      failedCount++;
    }
  }

  const buildTag = result.buildId ? ` [${result.buildId}]` : "";
  consola.success(
    `Pushed ${result.name}@${result.version}${buildTag} to ${pushCount} consumer(s) in ${timer.elapsed()} (${totalCopied} files changed, ${totalSkipped} unchanged)`
  );

  output({
    name: result.name,
    version: result.version,
    buildId: result.buildId,
    consumers: pushCount,
    failedConsumers: failedCount,
    copied: totalCopied,
    skipped: totalSkipped,
    elapsed: timer.elapsedMs(),
  });
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
  push: () => Promise<void>
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
    push
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

  if (buildCmd) {
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
