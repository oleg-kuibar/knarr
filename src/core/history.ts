import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, ensureDir, removeDir, moveDir, atomicWriteFile } from "../utils/fs.js";
import { getStoreHistoryPath, getHistoryEntryPath, getStoreEntryPath } from "../utils/paths.js";
import { verbose } from "../utils/logger.js";
import type { KnarrMeta, HistoryEntry } from "../types.js";

const DEFAULT_HISTORY_LIMIT = 3;

/**
 * Capture the current store entry as a history entry before it gets replaced.
 * Moves the old package/ and .knarr-meta.json into history/<buildId>/.
 */
export async function captureHistory(
  name: string,
  version: string,
  oldEntryDir: string,
  historyLimit?: number
): Promise<void> {
  // Read meta to get buildId
  const metaPath = join(oldEntryDir, ".knarr-meta.json");
  let meta: KnarrMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf-8"));
  } catch {
    verbose(`[history] Could not read meta from ${metaPath}, skipping history capture`);
    return;
  }

  const buildId = meta.buildId;
  if (!buildId) {
    verbose(`[history] No buildId in meta, skipping history capture`);
    return;
  }

  const historyDir = getStoreHistoryPath(name, version);
  const entryDir = getHistoryEntryPath(name, version, buildId);

  // Don't re-capture the same buildId
  if (await exists(entryDir)) {
    verbose(`[history] Build ${buildId} already in history, skipping`);
    return;
  }

  await ensureDir(historyDir);

  // Move the old entry into history/<buildId>/
  // We move the entire old entry dir contents (package/ + .knarr-meta.json)
  const tmpHistoryEntry = entryDir + `.tmp-${process.pid}`;
  try {
    await ensureDir(tmpHistoryEntry);

    // Move package/ dir
    const oldPkgDir = join(oldEntryDir, "package");
    if (await exists(oldPkgDir)) {
      await moveDir(oldPkgDir, join(tmpHistoryEntry, "package"));
    }

    // Copy meta
    await atomicWriteFile(
      join(tmpHistoryEntry, ".knarr-meta.json"),
      JSON.stringify(meta, null, 2)
    );

    await moveDir(tmpHistoryEntry, entryDir);
    verbose(`[history] Captured build ${buildId} to history`);
  } catch (err) {
    verbose(`[history] Failed to capture history: ${err instanceof Error ? err.message : String(err)}`);
    await removeDir(tmpHistoryEntry);
  }

  // Prune excess history entries
  const limit = historyLimit ?? DEFAULT_HISTORY_LIMIT;
  await pruneHistory(name, version, limit);
}

/**
 * List all history entries for a package, sorted by publishedAt (newest first).
 */
export async function listHistory(
  name: string,
  version: string
): Promise<HistoryEntry[]> {
  const historyDir = getStoreHistoryPath(name, version);
  if (!(await exists(historyDir))) return [];

  let entries: string[];
  try {
    entries = await readdir(historyDir);
  } catch {
    return [];
  }

  const result: HistoryEntry[] = [];
  for (const buildId of entries) {
    const entryDir = join(historyDir, buildId);
    const metaPath = join(entryDir, ".knarr-meta.json");
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf-8")) as KnarrMeta;
      result.push({
        buildId: meta.buildId ?? buildId,
        contentHash: meta.contentHash,
        publishedAt: meta.publishedAt,
        sourcePath: meta.sourcePath,
        packageDir: join(entryDir, "package"),
      });
    } catch {
      // skip unreadable entries
    }
  }

  // Sort newest first
  result.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return result;
}

/**
 * Get a specific history entry by buildId.
 */
export async function getHistoryEntry(
  name: string,
  version: string,
  buildId: string
): Promise<HistoryEntry | null> {
  const entryDir = getHistoryEntryPath(name, version, buildId);
  const metaPath = join(entryDir, ".knarr-meta.json");

  try {
    const meta = JSON.parse(await readFile(metaPath, "utf-8")) as KnarrMeta;
    return {
      buildId: meta.buildId ?? buildId,
      contentHash: meta.contentHash,
      publishedAt: meta.publishedAt,
      sourcePath: meta.sourcePath,
      packageDir: join(entryDir, "package"),
    };
  } catch {
    return null;
  }
}

/**
 * Restore a history entry as the current store entry.
 * Moves the history entry back to the main store position.
 */
export async function restoreHistoryEntry(
  name: string,
  version: string,
  buildId: string,
  historyLimit?: number
): Promise<HistoryEntry | null> {
  const entry = await getHistoryEntry(name, version, buildId);
  if (!entry) return null;

  const storeEntryDir = getStoreEntryPath(name, version);
  const historyEntryDir = getHistoryEntryPath(name, version, buildId);

  const historyPkg = join(historyEntryDir, "package");
  const historyMeta = join(historyEntryDir, ".knarr-meta.json");

  // Read the history meta first (before any mutations) so failure is clean
  const metaContent = await readFile(historyMeta, "utf-8");

  const storePkg = join(storeEntryDir, "package");
  const storeMeta = join(storeEntryDir, ".knarr-meta.json");
  if (!(await exists(historyPkg))) {
    throw new Error(`History entry ${buildId} is missing its package directory`);
  }

  const currentMetaContent = await readFile(storeMeta, "utf-8").catch(() => null);
  const oldEntryDir = storeEntryDir + `.restore-old-${process.pid}-${Date.now()}`;
  const oldPkg = join(oldEntryDir, "package");
  let stagedOld = false;
  let historyMovedToStore = false;

  try {
    if ((await exists(storePkg)) || currentMetaContent) {
      await ensureDir(oldEntryDir);
      if (await exists(storePkg)) {
        await moveDir(storePkg, oldPkg);
      }
      if (currentMetaContent) {
        await atomicWriteFile(join(oldEntryDir, ".knarr-meta.json"), currentMetaContent);
      }
      stagedOld = true;
    }

    await moveDir(historyPkg, storePkg);
    historyMovedToStore = true;
    await atomicWriteFile(storeMeta, metaContent);

    // Clean up history entry (package/ was moved, only meta remains)
    await removeDir(historyEntryDir);

    if (stagedOld) {
      try {
        await captureHistory(name, version, oldEntryDir, historyLimit);
      } finally {
        await removeDir(oldEntryDir);
      }
    }
  } catch (err) {
    // Preserve both sides when a restore fails mid-swap.
    if (historyMovedToStore && (await exists(storePkg))) {
      await ensureDir(historyEntryDir);
      await moveDir(storePkg, historyPkg);
    } else if (stagedOld && (await exists(storePkg))) {
      await removeDir(storePkg);
    }
    if (stagedOld && (await exists(oldPkg))) {
      await moveDir(oldPkg, storePkg);
    }
    if (currentMetaContent) {
      await atomicWriteFile(storeMeta, currentMetaContent);
    }
    await removeDir(oldEntryDir);
    throw err;
  }

  verbose(`[history] Restored build ${buildId} as current`);
  return entry;
}

/**
 * Prune history entries to keep only the most recent `limit` entries.
 */
export async function pruneHistory(
  name: string,
  version: string,
  limit: number
): Promise<number> {
  if (limit < 0) return 0;

  const entries = await listHistory(name, version);
  if (entries.length <= limit) return 0;

  const toRemove = entries.slice(limit);
  let removed = 0;
  for (const entry of toRemove) {
    const entryDir = getHistoryEntryPath(name, version, entry.buildId);
    try {
      await removeDir(entryDir);
      removed++;
      verbose(`[history] Pruned old build ${entry.buildId}`);
    } catch {
      // skip
    }
  }
  return removed;
}

/**
 * Remove all history for a package.
 */
export async function clearHistory(
  name: string,
  version: string
): Promise<void> {
  const historyDir = getStoreHistoryPath(name, version);
  if (await exists(historyDir)) {
    await removeDir(historyDir);
  }
}

/** Resolve the effective history limit from config or default */
export function resolveHistoryLimit(configValue?: number): number {
  return configValue ?? DEFAULT_HISTORY_LIMIT;
}
