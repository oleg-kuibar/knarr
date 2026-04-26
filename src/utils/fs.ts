import {
  copyFile,
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
  constants,
} from "node:fs/promises";
import { join, dirname, relative, parse as parsePath } from "node:path";
import pLimit from "./concurrency.js";
import { availableParallelism } from "node:os";
import { hashFile } from "./hash.js";
import { isDryRun } from "./logger.js";
import { verbose } from "./logger.js";
import { recordMutation } from "./dry-run.js";

/** Concurrency limit for parallel file I/O, auto-tuned to available CPUs */
const ioLimit = pLimit(Math.max(availableParallelism(), 8));

/** Type guard for Node.js system errors with an error code */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

// ── Reflink support cache ──
// Caches whether CoW reflinks work on each volume root, so the first failed
// FICLONE_FORCE is the only slow one. Inspired by Bun's per-directory
// syscall failure caching (has_ioctl_ficlone_failed, etc.)

const reflinkSupported = new Map<string, boolean>();

function volumeRoot(filePath: string): string {
  const { root } = parsePath(filePath);
  return root || "/";
}

/**
 * Copy a file using CoW (reflink) when available, with per-volume caching.
 *
 * On the first copy per volume, tries COPYFILE_FICLONE_FORCE to probe
 * for reflink support. If it fails, caches the result and all subsequent
 * copies on that volume go straight to a plain copy — no wasted syscalls.
 *
 * Note: hardlinks are intentionally NOT used as a fallback because Knarr's
 * incremental copy model compares source vs destination content. Hardlinks
 * share an inode, so source mutations silently propagate to the destination,
 * breaking change detection.
 */
export async function copyWithCoW(
  src: string,
  dest: string,
  options?: { ensureParent?: boolean }
): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would copy ${src} → ${dest}`);
    recordMutation({ type: "copy", path: src, dest });
    return;
  }
  if (options?.ensureParent !== false) {
    await mkdir(dirname(dest), { recursive: true });
  }

  const root = volumeRoot(dest);
  const supportsReflink = reflinkSupported.get(root);

  // Fast path: already know this volume doesn't support reflinks
  if (supportsReflink === false) {
    await copyFile(src, dest);
    return;
  }

  // Fast path: already confirmed reflink support
  if (supportsReflink === true) {
    await copyFile(src, dest, constants.COPYFILE_FICLONE);
    return;
  }

  // First copy on this volume: probe with FICLONE_FORCE (reflink-only, no fallback)
  try {
    await copyFile(src, dest, constants.COPYFILE_FICLONE_FORCE);
    reflinkSupported.set(root, true);
  } catch {
    reflinkSupported.set(root, false);
    verbose(`[copy] reflink not supported on ${root}, using plain copy`);
    await copyFile(src, dest);
  }
}

/**
 * Recursively collect all file paths in a directory.
 * Uses Node 22+ recursive readdir with withFileTypes to avoid separate stat calls.
 */
export async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

export interface IncrementalCopyOptions {
  /** Force copy all files, bypassing hash comparison */
  force?: boolean;
}

/**
 * Incrementally copy files from src to dest directory.
 * Only copies files whose content has changed (stat size check + hash comparison).
 * Also removes files in dest that don't exist in src.
 * Returns the number of files actually copied.
 */
export async function incrementalCopy(
  srcDir: string,
  destDir: string,
  options: IncrementalCopyOptions = {}
): Promise<{ copied: number; removed: number; skipped: number }> {
  // Kick off both directory walks in parallel (dest walk used for orphan detection)
  const srcFilesPromise = collectFiles(srcDir);
  const destFilesPromise = collectFiles(destDir).catch((err) => {
    if (isNodeError(err) && err.code === "ENOENT") return [] as string[];
    throw err;
  });

  const [srcFiles, destFiles] = await Promise.all([srcFilesPromise, destFilesPromise]);
  let copied = 0;
  let removed = 0;
  let skipped = 0;

  // Compare and copy files in parallel
  const results = await Promise.all(
    srcFiles.map((srcFile) =>
      ioLimit(async () => {
        const rel = relative(srcDir, srcFile);
        const destFile = join(destDir, rel);

        let needsCopy = true;
        let srcTimes: { atime: Date; mtime: Date } | null = null;

        // Force mode: always copy
        if (options.force) {
          verbose(`[copy] ${rel} (forced)`);
        } else {
          try {
            const [srcStat, destStat] = await Promise.all([
              stat(srcFile),
              stat(destFile),
            ]);
            srcTimes = { atime: srcStat.atime, mtime: srcStat.mtime };
            // Fast path: different sizes means definitely different content
            if (srcStat.size !== destStat.size) {
              verbose(`[copy] ${rel} (size differs: ${srcStat.size} vs ${destStat.size})`);
            } else if (srcStat.mtimeMs === destStat.mtimeMs) {
              // Same size + same mtime: Knarr is the sole writer, so skip without hashing
              needsCopy = false;
              verbose(`[skip] ${rel} (size+mtime match)`);
            } else {
              // Same size, different mtime: compare hashes (pass known sizes to skip redundant stat)
              const [srcHash, destHash] = await Promise.all([
                hashFile(srcFile, srcStat.size),
                hashFile(destFile, destStat.size),
              ]);
              if (srcHash === destHash) {
                needsCopy = false;
                verbose(`[skip] ${rel} (unchanged)`);
              } else {
                verbose(`[copy] ${rel} (hash differs)`);
              }
            }
          } catch (err) {
            if (isNodeError(err) && err.code === "ENOENT") {
              verbose(`[copy] ${rel} (new file)`);
            } else {
              throw err;
            }
          }
        }

        if (needsCopy) {
          await copyWithCoW(srcFile, destFile);
          // Preserve source mtime so the mtime fast-path fires on subsequent checks
          if (!srcTimes) {
            const s = await stat(srcFile);
            srcTimes = { atime: s.atime, mtime: s.mtime };
          }
          await utimes(destFile, srcTimes.atime, srcTimes.mtime);
          return "copied" as const;
        }
        return "skipped" as const;
      })
    )
  );

  for (const r of results) {
    if (r === "copied") copied++;
    else skipped++;
  }

  // Remove files in dest that don't exist in src (in parallel)
  const srcRelPaths = new Set(srcFiles.map((f) => relative(srcDir, f)));
  const filesToRemove = destFiles.filter(
    (f) => !srcRelPaths.has(relative(destDir, f))
  );
  await Promise.all(
    filesToRemove.map((destFile) =>
      ioLimit(async () => {
        verbose(`[remove] ${relative(destDir, destFile)} (no longer in source)`);
        if (isDryRun()) {
          recordMutation({ type: "remove", path: destFile });
        } else {
          await rm(destFile);
        }
      })
    )
  );
  removed = filesToRemove.length;

  return { copied, removed, skipped };
}

/**
 * Move a directory, handling cross-filesystem (EXDEV) scenarios.
 * Tries rename first (fast, atomic on same FS), falls back to cp+rm.
 */
export async function moveDir(src: string, dest: string): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would move ${src} → ${dest}`);
    recordMutation({ type: "move", path: src, dest });
    return;
  }
  try {
    await rename(src, dest);
  } catch (err) {
    if (isNodeError(err) && err.code === "EXDEV") {
      await cp(src, dest, { recursive: true });
      await rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/** Remove a directory recursively, no error if it doesn't exist */
export async function removeDir(dir: string): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would remove ${dir}`);
    recordMutation({ type: "remove", path: dir });
    return;
  }
  await rm(dir, { recursive: true, force: true });
}

/** Ensure a directory exists */
export async function ensureDir(dir: string): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would ensure dir ${dir}`);
    recordMutation({ type: "mkdir", path: dir });
    return;
  }
  await mkdir(dir, { recursive: true });
}

/** Ensure a directory exists with private permissions (0o700). */
export async function ensurePrivateDir(dir: string): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would ensure private dir ${dir}`);
    recordMutation({ type: "mkdir", path: dir });
    return;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/** Check if a path exists */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a file atomically by writing to a temp file then renaming.
 * Prevents corruption if the process crashes mid-write.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string
): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would write ${filePath}`);
    recordMutation({ type: "write", path: filePath });
    return;
  }
  const tmpPath = filePath + `.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
}

/** Calculate the total size of all files in a directory (recursive). */
export async function dirSize(dir: string): Promise<number> {
  try {
    const files = await collectFiles(dir);
    const stats = await Promise.all(
      files.map((f) => stat(f).then((s) => s.size).catch(() => 0))
    );
    return stats.reduce((sum, s) => sum + s, 0);
  } catch {
    return 0;
  }
}

/** Copy an entire directory recursively using native fs.cp */
export async function copyDir(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true });
}
