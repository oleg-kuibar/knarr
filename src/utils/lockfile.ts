import { mkdir, stat, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isNodeError } from "./fs.js";
import { isDryRun } from "./logger.js";
import { recordMutation } from "./dry-run.js";

const DEFAULTS = {
  retries: 5,
  minTimeout: 100,
  maxTimeout: 1000,
  factor: 2,
  stale: 30000,
};

/**
 * Execute a function while holding a directory-based lock.
 * Uses `mkdir` (non-recursive) as an atomic lock primitive — mkdir is atomic on all OSes.
 * Implements retry with exponential backoff and stale detection via stat mtime.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  lockOptions?: { stale?: number }
): Promise<T> {
  if (isDryRun()) {
    recordMutation({ type: "lock-skip", path: filePath });
    return fn();
  }

  await mkdir(dirname(filePath), { recursive: true });

  const lockDir = filePath + ".lk";
  const stale = lockOptions?.stale ?? DEFAULTS.stale;

  let acquired = false;

  for (let attempt = 0; attempt <= DEFAULTS.retries; attempt++) {
    try {
      await mkdir(lockDir);
      acquired = true;
      break;
    } catch (err) {
      if (isNodeError(err) && err.code === "EEXIST") {
        // Check if the lock is stale
        try {
          const s = await stat(lockDir);
          if (Date.now() - s.mtimeMs > stale) {
            await rm(lockDir, { recursive: true, force: true });
            continue; // Retry immediately after removing stale lock
          }
        } catch {
          // stat failed — lock may have been released, retry
          continue;
        }

        if (attempt < DEFAULTS.retries) {
          const delay = Math.min(
            DEFAULTS.minTimeout * DEFAULTS.factor ** attempt,
            DEFAULTS.maxTimeout,
          );
          await sleep(delay);
        }
      } else {
        throw err;
      }
    }
  }

  if (!acquired) {
    throw new Error(
      `Failed to acquire lock after ${DEFAULTS.retries} attempts. Another Knarr process may be running. If this persists, delete ${lockDir} and retry.`,
    );
  }

  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}
