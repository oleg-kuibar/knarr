import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { PackageManager } from "../types.js";

/** Valid package manager names */
const VALID_PMS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Lockfile → package manager mapping (checked in order) */
const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * Read the `packageManager` field from package.json (Corepack convention).
 * Parses values like "pnpm@9.0.0" or "bun@1.0.0+sha256.abc" → PackageManager.
 * Returns null if the field is missing, empty, or not a recognized PM.
 */
async function readPackageManagerField(
  dir: string
): Promise<PackageManager | null> {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (typeof pkg.packageManager !== "string") return null;
    const name = pkg.packageManager.split("@")[0];
    return VALID_PMS.has(name) ? (name as PackageManager) : null;
  } catch {
    return null;
  }
}

/**
 * Detect the package manager used in a project directory.
 * Checks `packageManager` field in package.json first (Corepack convention),
 * then falls back to lockfile presence, walking up to the filesystem root.
 * Closest match wins. Within the same directory, priority order is maintained.
 * Falls back to "npm" if nothing is found.
 */
export async function detectPackageManager(
  projectDir: string
): Promise<PackageManager> {
  let dir = projectDir;
  for (;;) {
    // Check packageManager field first (Corepack convention)
    const fromField = await readPackageManagerField(dir);
    if (fromField) return fromField;

    // Check lockfiles
    const results = await Promise.all(
      LOCKFILES.map(async ([lockfile, pm]) => {
        try {
          await stat(join(dir, lockfile));
          return pm;
        } catch {
          return null;
        }
      })
    );
    const found = results.find((pm) => pm !== null);
    if (found) return found;

    const parent = dirname(dir);
    if (parent === dir) return "npm"; // filesystem root
    dir = parent;
  }
}

export type YarnNodeLinker = "node-modules" | "pnpm" | "pnp";

/**
 * Detect the Yarn Berry nodeLinker mode from .yarnrc.yml.
 * Walks up from projectDir to find the file.
 * Returns null if the file is missing or the key is absent.
 */
export async function detectYarnNodeLinker(
  projectDir: string
): Promise<YarnNodeLinker | null> {
  let dir = projectDir;
  for (;;) {
    let content: string;
    try {
      content = await readFile(join(dir, ".yarnrc.yml"), "utf-8");
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
      continue;
    }

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("nodeLinker")) continue;
      const match = trimmed.match(/^nodeLinker:\s*(.+)$/);
      if (match) {
        const value = match[1].trim().replace(/^["']|["']$/g, "");
        if (value === "node-modules" || value === "pnpm" || value === "pnp") {
          return value;
        }
      }
    }

    return null;
  }
}

/**
 * Check whether a .yarnrc.yml file exists at or above the project directory.
 * Presence of this file indicates Yarn Berry (v2+) rather than Yarn Classic.
 */
export async function hasYarnrcYml(projectDir: string): Promise<boolean> {
  let dir = projectDir;
  for (;;) {
    try {
      await stat(join(dir, ".yarnrc.yml"));
      return true;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }
}
