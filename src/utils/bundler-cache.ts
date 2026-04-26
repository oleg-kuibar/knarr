import { join } from "node:path";
import { removeDir, exists } from "./fs.js";
import { detectAllBundlers } from "./bundler-detect.js";
import type { BundlerInfo, BundlerType } from "./bundler-detect.js";
import { isDryRun, verbose } from "./logger.js";
import { recordMutation } from "./dry-run.js";

/** Cache directories to clear for each bundler type.
 *  Vite is intentionally excluded — linked packages are served directly
 *  (excluded from optimizeDeps), so the .vite pre-bundle cache doesn't
 *  contain them. Clearing it just forces Vite to re-optimize unrelated
 *  deps and triggers an unnecessary full page reload. The Vite plugin
 *  handles cache clearing when it's actually needed (new package linked). */
const CACHE_DIRS: Partial<Record<NonNullable<BundlerType>, string[]>> = {
  next: [".next/cache"],
  webpack: ["node_modules/.cache"],
};

/** Per-consumer cache of detected bundlers to avoid redundant fs checks */
const bundlerCache = new Map<string, BundlerInfo[]>();

/** Reset the bundler detection cache (for testing) */
export function resetBundlerDetectionCache(): void {
  bundlerCache.clear();
}

export async function invalidateBundlerCache(
  consumerPath: string
): Promise<void> {
  if (isDryRun()) {
    verbose(`[dry-run] would invalidate bundler caches for ${consumerPath}`);
    recordMutation({ type: "cache-invalidate", path: consumerPath });
    return;
  }

  let bundlers = bundlerCache.get(consumerPath);
  if (!bundlers) {
    bundlers = await detectAllBundlers(consumerPath);
    bundlerCache.set(consumerPath, bundlers);
  }

  for (const bundler of bundlers) {
    if (!bundler.type) continue;
    const dirs = CACHE_DIRS[bundler.type];
    if (!dirs) continue;

    for (const dir of dirs) {
      const cacheDir = join(consumerPath, dir);
      if (await exists(cacheDir)) {
        try {
          await removeDir(cacheDir);
          verbose(`[inject] Invalidated ${bundler.type} cache: ${dir}`);
        } catch {
          // Dev server might have the dir locked (especially on Windows)
          verbose(`[inject] Could not clear ${bundler.type} cache: ${dir} (locked?)`);
        }
      }
    }
  }
}
