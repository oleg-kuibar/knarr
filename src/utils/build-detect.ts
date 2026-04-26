import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageManager } from "../types.js";

/**
 * Detect the build command from package.json scripts.
 * Returns a fully qualified run command (e.g. "pnpm build") or null if none found.
 * Non-interactive — callers can wrap with prompts if needed.
 */
export async function detectBuildCommand(
  packageDir: string,
  pm: PackageManager,
): Promise<string | null> {
  const runPrefix = pm === "npm" ? "npm run " : `${pm} `;
  try {
    const pkg = JSON.parse(
      await readFile(join(packageDir, "package.json"), "utf-8"),
    );
    const scripts = pkg.scripts || {};

    for (const name of ["build", "compile", "bundle", "tsc"]) {
      if (scripts[name]) {
        return `${runPrefix}${name}`;
      }
    }
  } catch {
    // ignore parse errors or missing file
  }

  return null;
}
