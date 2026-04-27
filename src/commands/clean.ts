import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import { consola } from "../utils/console.js";
import {
  readConsumersRegistry,
  readConsumerStateSafe,
  cleanStaleConsumers,
} from "../core/tracker.js";
import { listStoreEntries, removeStoreEntry } from "../core/store.js";
import { exists, removeDir, dirSize } from "../utils/fs.js";
import { formatBytes } from "../utils/format.js";
import { isDryRun, verbose } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { getStorePath, normalizePath } from "../utils/paths.js";
import { Timer } from "../utils/timer.js";

export default defineCommand({
  meta: {
    name: "clean",
    description:
      "Remove unreferenced store entries and stale consumer registrations",
  },
  args: {
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip confirmation prompts",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const timer = new Timer();

    // 1. Clean stale consumers (directories that no longer exist)
    consola.start("Checking consumer registrations...");
    const { removedConsumers, removedPackages } = await cleanStaleConsumers();
    if (removedConsumers > 0) {
      consola.success(
        `Removed ${removedConsumers} stale consumer registration(s) across ${removedPackages} package(s)`
      );
    }

    // 2. Collect all referenced name@version pairs from live consumers
    const registry = await readConsumersRegistry();
    const referenced = new Set<string>();

    const allConsumerPaths = [...new Set(Object.values(registry).flat())];
    const states = await Promise.all(
      allConsumerPaths.map(async (p) => {
        const { state, reliable } = await readConsumerStateSafe(p);
        return { path: p, state, reliable };
      })
    );
    for (const { state, reliable } of states) {
      if (reliable) {
        for (const [pkgName, link] of Object.entries(state.links)) {
          referenced.add(`${pkgName}@${link.version}`);
        }
      }
    }

    // Protect ALL packages registered to consumers with corrupt state files.
    // We can't read their links, so we must preserve any store entry they might reference.
    const protectedPackages = new Set<string>();
    const unreliableConsumers = states.filter((s) => !s.reliable);
    if (unreliableConsumers.length > 0) {
      consola.warn(
        `${unreliableConsumers.length} consumer(s) have corrupt state; their store entries will be preserved`
      );
      const unreliablePaths = new Set(
        unreliableConsumers.map((s) => normalizePath(s.path))
      );
      for (const [pkgName, consumers] of Object.entries(registry)) {
        if (consumers.some((c) => unreliablePaths.has(c))) {
          protectedPackages.add(pkgName);
        }
      }
      verbose(`[clean] Protected packages (corrupt state): ${[...protectedPackages].join(", ")}`);
    }

    verbose(`[clean] Referenced entries: ${[...referenced].join(", ") || "(none)"}`);

    // 3. Find unreferenced store entries
    const storeEntries = await listStoreEntries();
    const entriesToRemove: typeof storeEntries = [];

    for (const entry of storeEntries) {
      const key = `${entry.name}@${entry.version}`;
      if (!referenced.has(key)) {
        if (protectedPackages.has(entry.name)) {
          verbose(`[clean] Preserving ${key} (consumer state unreadable)`);
          continue;
        }
        const age = Date.now() - new Date(entry.meta.publishedAt).getTime();
        if (age < 5 * 60 * 1000) {
          verbose(`[clean] Skipping recently published entry: ${key} (${Math.round(age / 1000)}s old)`);
          continue;
        }
        entriesToRemove.push(entry);
      }
    }

    // 4. Find orphaned temp/old directories
    const orphanDirs: string[] = [];
    const storePath = getStorePath();
    if (await exists(storePath)) {
      const allDirs = await readdir(storePath, { withFileTypes: true });
      for (const dir of allDirs) {
        if (!dir.isDirectory()) continue;
        if (dir.name.includes(".tmp-") || dir.name.includes(".old-")) {
          orphanDirs.push(dir.name);
        }
      }
    }

    // Confirm before deleting
    const totalToRemove = entriesToRemove.length + orphanDirs.length;
    if (totalToRemove > 0 && !args.yes) {
      const parts: string[] = [];
      if (entriesToRemove.length > 0) {
        parts.push(`${entriesToRemove.length} unreferenced store entry(ies)`);
      }
      if (orphanDirs.length > 0) {
        parts.push(`${orphanDirs.length} orphaned temp directory(ies)`);
      }
      const confirmed = await consola.prompt(
        `Remove ${parts.join(" and ")}?`,
        { type: "confirm" }
      );
      if (!confirmed || typeof confirmed === "symbol") {
        consola.info("Cancelled");
        return;
      }
    }

    // Measure sizes before removal
    let reclaimedBytes = 0;
    const entrySizes = await Promise.all(
      entriesToRemove.map((entry) => dirSize(entry.packageDir))
    );
    const orphanSizes = await Promise.all(
      orphanDirs.map((dirName) => dirSize(join(storePath, dirName)))
    );

    // Remove unreferenced entries
    let removedEntries = 0;
    for (let i = 0; i < entriesToRemove.length; i++) {
      const entry = entriesToRemove[i];
      verbose(`[clean] Removing unreferenced store entry: ${entry.name}@${entry.version}`);
      await removeStoreEntry(entry.name, entry.version);
      reclaimedBytes += entrySizes[i];
      removedEntries++;
    }
    if (removedEntries > 0) {
      consola.success(`Removed ${removedEntries} unreferenced store entry(ies)`);
    }

    // Remove orphaned directories
    let removedOrphans = 0;
    for (let i = 0; i < orphanDirs.length; i++) {
      verbose(`[clean] Removing orphaned directory: ${orphanDirs[i]}`);
      await removeDir(join(storePath, orphanDirs[i]));
      reclaimedBytes += orphanSizes[i];
      removedOrphans++;
    }
    if (removedOrphans > 0) {
      consola.success(`Removed ${removedOrphans} orphaned temp directory(ies)`);
    }

    if (removedConsumers === 0 && removedEntries === 0 && removedOrphans === 0) {
      consola.info("Store is clean; no stale entries or registrations found");
    }

    const reclaimedTag = reclaimedBytes > 0 ? ` (reclaimed ${formatBytes(reclaimedBytes)})` : "";
    consola.info(`Clean complete in ${timer.elapsed()}${reclaimedTag}`);
    output({
      removedConsumers,
      removedPackages,
      removedEntries,
      removedOrphans,
      reclaimedBytes,
      elapsed: timer.elapsedMs(),
    });

    if (isDryRun()) printDryRunReport();
  },
});
