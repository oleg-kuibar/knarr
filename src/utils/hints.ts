import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, relative } from "node:path";

let cachedKnarrCommand: string | undefined;

/**
 * How the user should invoke Knarr in a suggested command: `knarr` when it is
 * on PATH (global install), otherwise `npx knarr` (one-off `npx knarr use`, or
 * a project-local install).
 */
export function knarrCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env === process.env && cachedKnarrCommand) return cachedKnarrCommand;
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const names = platform === "win32" ? ["knarr.cmd", "knarr.exe", "knarr.ps1", "knarr"] : ["knarr"];
  const sep = platform === "win32" ? ";" : delimiter;
  const onPath = pathValue
    .split(sep)
    .filter(Boolean)
    .some((dir) => names.some((name) => existsSync(join(dir, name))));
  const command = onPath ? "knarr" : "npx knarr";
  if (env === process.env) cachedKnarrCommand = command;
  return command;
}

/**
 * A path to show in a `cd` hint: relative to `cwd` when that is shorter and
 * stays on the same drive, quoted when it contains spaces.
 */
export function displayPath(target: string, cwd: string = process.cwd()): string {
  const rel = relative(cwd, target);
  const chosen = rel === "" ? "." : !isAbsolute(rel) && rel.length < target.length ? rel : target;
  return /\s/.test(chosen) ? `"${chosen}"` : chosen;
}

/**
 * The "now start the dev loop in the library" hint. Inside a workspace, point
 * at the root: `dev --all` watches every package and rebuilds dependents.
 */
export function devLoopHint(
  sourcePath: string,
  cwd: string = process.cwd(),
  workspaceRoot?: string | null
): string {
  if (workspaceRoot && workspaceRoot !== sourcePath) {
    return `cd ${displayPath(workspaceRoot, cwd)} && ${knarrCommand()} dev --all`;
  }
  return `cd ${displayPath(sourcePath, cwd)} && ${knarrCommand()} dev`;
}
