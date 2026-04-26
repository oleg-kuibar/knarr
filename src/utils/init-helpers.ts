import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "./console.js";
import pc from "picocolors";
import { exists, ensureDir } from "./fs.js";
import { getConsumerStatePath, getConsumerKnarrDir } from "./paths.js";
import { readConsumerState, writeConsumerState } from "../core/tracker.js";
import type { PackageManager } from "../types.js";

/**
 * Ensure .knarr/ is in .gitignore. Returns true if it was added.
 */
export async function ensureGitignore(
  gitignorePath: string,
): Promise<boolean> {
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // .gitignore doesn't exist, create it
  }

  const lines = content.split("\n");
  const alreadyIgnored = lines.some(
    (line) =>
      line.trim() === ".knarr/" ||
      line.trim() === ".knarr" ||
      line.trim() === "/.knarr/" ||
      line.trim() === "/.knarr" ||
      line.trim() === ".plunk/" ||
      line.trim() === ".plunk" ||
      line.trim() === "/.plunk/" ||
      line.trim() === "/.plunk",
  );

  if (alreadyIgnored) return false;

  const separator =
    content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const section =
    content.length > 0
      ? "\n# knarr local links\n.knarr/\n"
      : "# knarr local links\n.knarr/\n";
  await writeFile(gitignorePath, content + separator + section);
  return true;
}

/**
 * Add "postinstall": "npx knarr restore || true" to package.json scripts.
 * Uses npx to ensure the command works even if knarr isn't globally installed.
 * Returns true if it was added.
 */
export async function addPostinstall(pkgPath: string): Promise<boolean> {
  const content = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(content);

  if (pkg.scripts?.postinstall) {
    if (pkg.scripts.postinstall.includes("knarr") || pkg.scripts.postinstall.includes("plunk")) return false;
    consola.warn(
      `Existing postinstall script found. Add ${pc.cyan("npx knarr restore")} manually if needed.`,
    );
    return false;
  }

  if (!pkg.scripts) pkg.scripts = {};
  pkg.scripts.postinstall = "npx knarr restore || true";

  const indent = content.match(/^(\s+)"/m)?.[1] || "  ";
  await writeFile(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
  return true;
}

/**
 * Remove the knarr postinstall script from package.json.
 * Returns true if it was removed.
 */
export async function removePostinstall(pkgPath: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(pkgPath, "utf-8");
  } catch {
    return false;
  }
  const pkg = JSON.parse(content);
  if (!pkg.scripts?.postinstall?.includes("knarr") && !pkg.scripts?.postinstall?.includes("plunk")) return false;

  delete pkg.scripts.postinstall;
  // Clean up empty scripts object
  if (Object.keys(pkg.scripts).length === 0) {
    delete pkg.scripts;
  }
  const indent = content.match(/^(\s+)"/m)?.[1] || "  ";
  await writeFile(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
  return true;
}

/**
 * Auto-initialize a consumer project: create .knarr/state.json,
 * add .knarr/ to .gitignore, add postinstall script.
 */
export async function ensureConsumerInit(
  projectDir: string,
  pm: PackageManager,
): Promise<void> {
  const knarrDir = getConsumerKnarrDir(projectDir);
  const statePath = getConsumerStatePath(projectDir);

  if (!(await exists(statePath))) {
    await ensureDir(knarrDir);
    await writeConsumerState(projectDir, {
      version: "1",
      packageManager: pm,
      role: "consumer",
      links: {},
    });
  } else {
    // Ensure PM is recorded
    const state = await readConsumerState(projectDir);
    if (!state.packageManager) {
      state.packageManager = pm;
      state.role = state.role ?? "consumer";
      await writeConsumerState(projectDir, state);
    }
  }

  const gitignorePath = join(projectDir, ".gitignore");
  await ensureGitignore(gitignorePath);

  const pkgPath = join(projectDir, "package.json");
  if (await exists(pkgPath)) {
    await addPostinstall(pkgPath);
  }
}
