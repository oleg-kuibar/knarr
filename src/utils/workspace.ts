import { readFile, readdir } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import picomatch from "picomatch";
import { exists } from "./fs.js";
import { normalizePath } from "./paths.js";
import type { PackageJson } from "../types.js";

export interface WorkspacePackage {
  name: string;
  version: string;
  dir: string;
  pkg: PackageJson;
}

export interface WorkspaceGraph {
  packages: WorkspacePackage[];
  /** Map of package name → Set of in-workspace dependency names */
  adjacency: Map<string, Set<string>>;
}

export interface Catalogs {
  default: Record<string, string>;
  named: Record<string, Record<string, string>>;
}

/**
 * Walk up from startDir looking for pnpm-workspace.yaml.
 * Returns the directory containing it, or null if not found.
 */
export async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    if (await exists(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Parse pnpm-workspace.yaml for catalog definitions.
 * Handles the flat key-value structure that catalogs use:
 *
 *   catalog:          (default catalog)
 *     react: ^18.0.0
 *
 *   catalogs:         (named catalogs)
 *     react17:
 *       react: ^17.0.0
 *
 * This is a minimal line-by-line parser — no YAML library needed since
 * catalogs only use flat string key-value pairs (no anchors, multiline, etc).
 */
export async function parseCatalogs(workspaceRoot: string): Promise<Catalogs> {
  const result: Catalogs = { default: {}, named: {} };
  const filePath = join(workspaceRoot, "pnpm-workspace.yaml");

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return result;
  }

  const lines = content.split(/\r?\n/);

  type State = "top" | "default-catalog" | "named-catalogs" | "named-catalog-entries";
  let state: State = "top";
  let currentNamedCatalog = "";

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // Top-level keys (no indent)
    if (indent === 0) {
      if (line.startsWith("catalog:")) {
        state = "default-catalog";
        // Inline value like `catalog: { ... }` is not used in practice
        continue;
      }
      if (line.startsWith("catalogs:")) {
        state = "named-catalogs";
        continue;
      }
      // Any other top-level key resets state
      state = "top";
      continue;
    }

    // Inside `catalog:` — 2-space indented key-value pairs
    if (state === "default-catalog" && indent >= 2) {
      const kv = parseKeyValue(line);
      if (kv) result.default[kv[0]] = kv[1];
      continue;
    }

    // Inside `catalogs:` — 2-space indent = named catalog header
    if (state === "named-catalogs" && indent >= 2 && indent < 4) {
      const trimmed = line.trim();
      if (trimmed.endsWith(":")) {
        currentNamedCatalog = trimmed.slice(0, -1);
        result.named[currentNamedCatalog] = {};
        state = "named-catalog-entries";
      }
      continue;
    }

    // Inside a named catalog — 4-space indented key-value pairs
    if (state === "named-catalog-entries" && indent >= 4) {
      const kv = parseKeyValue(line);
      if (kv && currentNamedCatalog) {
        result.named[currentNamedCatalog][kv[0]] = kv[1];
      }
      continue;
    }

    // 2-space indent but we're in named-catalog-entries → new named catalog or exit
    if (state === "named-catalog-entries" && indent >= 2 && indent < 4) {
      const trimmed = line.trim();
      if (trimmed.endsWith(":")) {
        currentNamedCatalog = trimmed.slice(0, -1);
        result.named[currentNamedCatalog] = {};
      } else {
        state = "named-catalogs";
      }
      continue;
    }
  }

  return result;
}

/**
 * Find all workspace package directories.
 * Supports pnpm (pnpm-workspace.yaml) and npm/yarn (package.json workspaces field).
 * Returns absolute paths to directories that contain a package.json.
 */
export async function findWorkspacePackages(startDir: string): Promise<string[]> {
  // Try pnpm-workspace.yaml first
  const pnpmRoot = await findWorkspaceRoot(startDir);
  if (pnpmRoot) {
    const allPatterns = await parsePnpmWorkspacePackages(pnpmRoot);
    const positive = allPatterns.filter((p) => !p.startsWith("!"));
    const negations = allPatterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
    if (positive.length > 0) {
      return resolveWorkspaceGlobs(pnpmRoot, positive, negations);
    }
  }

  // Fall back to npm/yarn workspaces field in package.json
  const rootDir = pnpmRoot ?? await findPackageJsonWorkspaceRoot(startDir);
  if (!rootDir) return [];

  try {
    const rootPkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf-8"));
    const workspaces: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces?.packages ?? [];
    if (workspaces.length === 0) return [];
    const positive = workspaces.filter((p) => !p.startsWith("!"));
    const negations = workspaces.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
    return resolveWorkspaceGlobs(rootDir, positive, negations);
  } catch {
    return [];
  }
}

/**
 * Parse pnpm-workspace.yaml for the `packages:` field.
 * Returns glob patterns like ["packages/*", "apps/*"].
 * Negation patterns (e.g., "!packages/internal") are preserved.
 */
async function parsePnpmWorkspacePackages(workspaceRoot: string): Promise<string[]> {
  const filePath = join(workspaceRoot, "pnpm-workspace.yaml");
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const patterns: string[] = [];
  let inPackages = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inPackages = trimmed === "packages:";
      continue;
    }

    if (inPackages && indent >= 2) {
      // Lines like `  - "packages/*"` or `  - packages/*`
      const match = trimmed.match(/^-\s+["']?([^"']+)["']?$/);
      if (match) {
        patterns.push(match[1]);
      }
    }
  }

  return patterns;
}

/**
 * Walk up from startDir looking for a package.json with a `workspaces` field.
 */
async function findPackageJsonWorkspaceRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
      if (pkg.workspaces) return dir;
    } catch {
      // no package.json at this level
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve workspace glob patterns to actual package directories.
 * Each pattern like "packages/*" is expanded to actual directories containing package.json.
 * Negation patterns (e.g., "packages/internal") are excluded from the results.
 */
async function resolveWorkspaceGlobs(rootDir: string, patterns: string[], negations: string[] = []): Promise<string[]> {
  const results: string[] = [];

  for (const pattern of patterns) {
    // If pattern has a wildcard, expand it
    if (pattern.includes("*")) {
      // Find the static prefix before the first wildcard
      const parts = pattern.split("/");
      let staticPrefix = rootDir;
      const globParts: string[] = [];
      let foundGlob = false;
      for (const part of parts) {
        if (foundGlob || part.includes("*")) {
          foundGlob = true;
          globParts.push(part);
        } else {
          staticPrefix = join(staticPrefix, part);
        }
      }

      if (globParts.length === 1 && globParts[0] === "*") {
        // Simple case: "packages/*" → list immediate subdirs
        try {
          const entries = await readdir(staticPrefix, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pkgDir = join(staticPrefix, entry.name);
              if (await exists(join(pkgDir, "package.json"))) {
                results.push(pkgDir);
              }
            }
          }
        } catch {
          // directory doesn't exist
        }
      } else {
        // Complex glob: use picomatch
        const isMatch = picomatch(pattern);
        const candidates = await collectDirs(rootDir, 8);
        for (const candidate of candidates) {
          const rel = normalizePath(relative(rootDir, candidate));
          if (isMatch(rel) && await exists(join(candidate, "package.json"))) {
            results.push(candidate);
          }
        }
      }
    } else {
      // Literal path
      const pkgDir = resolve(rootDir, pattern);
      if (await exists(join(pkgDir, "package.json"))) {
        results.push(pkgDir);
      }
    }
  }

  const unique = [...new Set(results)];
  if (negations.length === 0) return unique;

  // Apply negation patterns to filter out excluded directories
  const isExcluded = picomatch(negations);
  return unique.filter((dir) => {
    const rel = normalizePath(relative(rootDir, dir));
    return !isExcluded(rel);
  });
}

/** Collect directories up to a given depth */
async function collectDirs(dir: string, maxDepth: number): Promise<string[]> {
  if (maxDepth <= 0) return [];
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      results.push(full);
      results.push(...await collectDirs(full, maxDepth - 1));
    }
  } catch {
    // directory doesn't exist or can't be read
  }
  return results;
}

/**
 * Build a workspace dependency graph for topological sorting.
 * Reads all workspace packages and builds an adjacency map of
 * in-workspace dependencies (both dependencies and devDependencies).
 */
export async function buildWorkspaceGraph(
  startDir: string
): Promise<WorkspaceGraph> {
  const dirs = await findWorkspacePackages(startDir);
  const packages: WorkspacePackage[] = [];

  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf-8")
      ) as PackageJson;
      if (pkg.name && pkg.version) {
        packages.push({ name: pkg.name, version: pkg.version, dir, pkg });
      }
    } catch {
      // skip unreadable packages
    }
  }

  // Set of all workspace package names for filtering
  const wsNames = new Set(packages.map((p) => p.name));

  // Build adjacency: for each package, collect its in-workspace deps
  const adjacency = new Map<string, Set<string>>();
  for (const wp of packages) {
    const deps = new Set<string>();
    for (const field of ["dependencies", "devDependencies"] as const) {
      const depMap = wp.pkg[field];
      if (!depMap) continue;
      for (const depName of Object.keys(depMap)) {
        if (wsNames.has(depName)) {
          deps.add(depName);
        }
      }
    }
    adjacency.set(wp.name, deps);
  }

  return { packages, adjacency };
}

/**
 * Build a reverse adjacency map: for each package, which packages depend on it.
 * Used by WatchOrchestrator to trigger cascading rebuilds.
 */
export function buildReverseAdjacency(
  adjacency: Map<string, Set<string>>
): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  for (const name of adjacency.keys()) {
    reverse.set(name, new Set());
  }
  for (const [name, deps] of adjacency) {
    for (const dep of deps) {
      let set = reverse.get(dep);
      if (!set) {
        set = new Set();
        reverse.set(dep, set);
      }
      set.add(name);
    }
  }
  return reverse;
}

/** Parse a YAML key-value line like `  react: ^18.0.0` */
function parseKeyValue(line: string): [string, string] | null {
  const trimmed = line.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return null;
  const key = trimmed.slice(0, colonIdx).trim();
  const value = trimmed.slice(colonIdx + 1).trim();
  if (!key || !value) return null;
  // Remove optional quotes around value
  const unquoted = value.replace(/^["']|["']$/g, "");
  return [key, unquoted];
}
