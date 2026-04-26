import { join } from "node:path";
import { exists } from "./fs.js";

export type BundlerType = "vite" | "next" | "webpack" | "turbo" | "rollup" | null;

export interface BundlerInfo {
  type: BundlerType;
  configFile: string | null;
}

/** Config file patterns to check, in priority order */
const BUNDLER_CONFIGS: [BundlerType, string[]][] = [
  ["vite", ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]],
  ["next", ["next.config.js", "next.config.ts", "next.config.mjs"]],
  ["webpack", ["webpack.config.js", "webpack.config.ts"]],
  ["turbo", ["turbo.json"]],
  ["rollup", ["rollup.config.js", "rollup.config.ts", "rollup.config.mjs"]],
];

/**
 * Detect the bundler used in a project directory
 * by checking for config file presence.
 * Returns the first match in priority order.
 */
export async function detectBundler(projectDir: string): Promise<BundlerInfo> {
  for (const [type, configFiles] of BUNDLER_CONFIGS) {
    for (const configFile of configFiles) {
      const fullPath = join(projectDir, configFile);
      if (await exists(fullPath)) {
        return { type, configFile: fullPath };
      }
    }
  }
  return { type: null, configFile: null };
}

/**
 * Detect ALL bundlers present in a project directory.
 * A Next.js project may also have webpack caches, etc.
 * Checks all config files in parallel for speed.
 */
export async function detectAllBundlers(projectDir: string): Promise<BundlerInfo[]> {
  // Check all candidate config files in parallel
  const checks = BUNDLER_CONFIGS.flatMap(([type, configFiles]) =>
    configFiles.map(async (configFile) => ({
      type,
      configFile: join(projectDir, configFile),
      found: await exists(join(projectDir, configFile)),
    }))
  );
  const all = await Promise.all(checks);

  // De-duplicate: keep first match per bundler type
  const seen = new Set<BundlerType>();
  const results: BundlerInfo[] = [];
  for (const { type, configFile, found } of all) {
    if (found && !seen.has(type)) {
      seen.add(type);
      results.push({ type, configFile });
    }
  }
  return results;
}
