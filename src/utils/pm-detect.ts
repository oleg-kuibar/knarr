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
  ["npm-shrinkwrap.json", "npm"],
];

const YARN_PNP_MANIFESTS = [".pnp.cjs", ".pnp.js", ".pnp.loader.mjs"];
const YARN_PROJECT_ARTIFACTS = [".yarnrc.yml", ...YARN_PNP_MANIFESTS];

interface PackageManagerSpec {
  name: PackageManager;
  version: string;
}

export type PackageManagerDetectionSource =
  | "packageManager"
  | "lockfile"
  | "yarnArtifact"
  | "default";

export interface PackageManagerDetection {
  packageManager: PackageManager;
  source: PackageManagerDetectionSource;
  dir: string;
  file?: string;
}

function parsePackageManagerSpec(value: unknown): PackageManagerSpec | null {
  if (typeof value !== "string") return null;

  const match = value.trim().match(/^([^@\s]+)(?:@(.+))?$/);
  if (!match) return null;

  const name = match[1];
  if (!VALID_PMS.has(name)) return null;

  return {
    name: name as PackageManager,
    version: match[2]?.trim() ?? "",
  };
}

/**
 * Read the `packageManager` field from package.json (Corepack convention).
 * Parses values like "pnpm@9.0.0" or "bun@1.0.0+sha256.abc" → PackageManager.
 * Returns null if the field is missing, empty, or not a recognized PM.
 */
async function readPackageManagerSpec(
  dir: string
): Promise<PackageManagerSpec | null> {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    return parsePackageManagerSpec(pkg.packageManager);
  } catch {
    return null;
  }
}

async function findPackageManagerSpec(
  projectDir: string
): Promise<PackageManagerSpec | null> {
  let dir = projectDir;
  for (;;) {
    const spec = await readPackageManagerSpec(dir);
    if (spec) return spec;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function yarnDefaultsToPnp(version: string): boolean {
  const normalized = version.trim().replace(/^npm:/, "");
  if (normalized === "classic") return false;

  const major = normalized.match(/^v?(\d+)(?:[.+-]|$)/);
  if (major) return Number(major[1]) >= 2;

  // Corepack channels like stable/latest/berry point at modern Yarn.
  return normalized.length > 0;
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
  return (await detectPackageManagerInfo(projectDir)).packageManager;
}

/**
 * Detect the package manager and return where the decision came from.
 * Useful for distinguishing an explicit npm project from the npm fallback.
 */
export async function detectPackageManagerInfo(
  projectDir: string
): Promise<PackageManagerDetection> {
  let dir = projectDir;
  for (;;) {
    // Check packageManager field first (Corepack convention)
    const fromField = await readPackageManagerSpec(dir);
    if (fromField) {
      return {
        packageManager: fromField.name,
        source: "packageManager",
        dir,
        file: join(dir, "package.json"),
      };
    }

    // Check lockfiles
    const results = await Promise.all(
      LOCKFILES.map(async ([lockfile, packageManager]) => {
        try {
          await stat(join(dir, lockfile));
          return { lockfile, packageManager };
        } catch {
          return null;
        }
      })
    );
    const found = results.find((result) => result !== null);
    if (found) {
      return {
        packageManager: found.packageManager,
        source: "lockfile",
        dir,
        file: join(dir, found.lockfile),
      };
    }

    const yarnArtifact = await findExistingFile(dir, YARN_PROJECT_ARTIFACTS);
    if (yarnArtifact) {
      return {
        packageManager: "yarn",
        source: "yarnArtifact",
        dir,
        file: join(dir, yarnArtifact),
      };
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return {
        packageManager: "npm",
        source: "default",
        dir: projectDir,
      };
    }
    dir = parent;
  }
}

async function findExistingFile(
  dir: string,
  filenames: readonly string[]
): Promise<string | null> {
  for (const filename of filenames) {
    try {
      await stat(join(dir, filename));
      return filename;
    } catch {
      // Missing or unreadable files are treated as absent.
    }
  }
  return null;
}

export type YarnNodeLinker = "node-modules" | "pnpm" | "pnp";

function readYarnrcScalar(content: string, key: string): string | null {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes(key)) continue;
    const match = trimmed.match(new RegExp(`^${key}:\\s*(.+)$`));
    if (!match) continue;

    const value = match[1]
      .trim()
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return null;
}

async function findYarnrcScalar(
  projectDir: string,
  key: string
): Promise<string | null> {
  let dir = projectDir;
  for (;;) {
    try {
      const content = await readFile(join(dir, ".yarnrc.yml"), "utf-8");
      const value = readYarnrcScalar(content, key);
      if (value) return value;
    } catch {
      // Missing or unreadable yarnrc files are treated as absent.
    }

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Detect the Yarn Berry nodeLinker mode from .yarnrc.yml.
 * Walks up from projectDir to find the nearest configured value.
 * Returns null if the file is missing or the key is absent.
 */
export async function detectYarnNodeLinker(
  projectDir: string
): Promise<YarnNodeLinker | null> {
  const value = await findYarnrcScalar(projectDir, "nodeLinker");
  if (value === "node-modules" || value === "pnpm" || value === "pnp") {
    return value;
  }
  return null;
}

/**
 * Detect the optional Yarn pnpm-linker store folder from .yarnrc.yml.
 */
export async function detectYarnPnpmStoreFolder(
  projectDir: string
): Promise<string | null> {
  return findYarnrcScalar(projectDir, "pnpmStoreFolder");
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

/**
 * Check whether a Yarn PnP manifest exists at or above the project directory.
 */
export async function hasYarnPnpManifest(projectDir: string): Promise<boolean> {
  let dir = projectDir;
  for (;;) {
    const results = await Promise.all(
      YARN_PNP_MANIFESTS.map(async (manifest) => {
        try {
          await stat(join(dir, manifest));
          return true;
        } catch {
          return false;
        }
      })
    );
    if (results.some(Boolean)) return true;

    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Check for explicit Yarn PnP artifacts regardless of package-manager detection.
 */
export async function hasYarnPnpMarkers(projectDir: string): Promise<boolean> {
  if (await hasYarnPnpManifest(projectDir)) return true;
  return (await detectYarnNodeLinker(projectDir)) === "pnp";
}

/**
 * Detect whether a Yarn project is using, or will default to, Plug'n'Play.
 * Knarr requires a node_modules-compatible linker for package injection.
 */
export async function isYarnPnpProject(projectDir: string): Promise<boolean> {
  const linker = await detectYarnNodeLinker(projectDir);
  if (linker === "pnp") return true;
  if (linker === "node-modules" || linker === "pnpm") return false;

  if (await hasYarnPnpManifest(projectDir)) return true;
  if (await hasYarnrcYml(projectDir)) return true;

  const spec = await findPackageManagerSpec(projectDir);
  return spec?.name === "yarn" && yarnDefaultsToPnp(spec.version);
}
