import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { consola } from "./console.js";
import type { PackageJson } from "../types.js";
import { isNodeError } from "./fs.js";
import { normalizePath } from "./paths.js";

/**
 * Resolve the list of publishable files for a package.
 * Mimics `npm pack` logic:
 * 1. If `files` field exists in package.json, use those globs (always includes package.json)
 * 2. If no `files` field, include everything except common ignores
 * 3. Respect .npmignore if present
 *
 * Returns absolute file paths.
 */
export async function resolvePackFiles(
  packageDir: string,
  pkg: PackageJson
): Promise<string[]> {
  const files: string[] = [];
  const absDir = resolve(packageDir);

  // package.json is always included
  files.push(join(absDir, "package.json"));

  // Walk directory tree once, cache result
  const allFiles = await collectAllFiles(absDir, absDir);
  const allRelPaths = allFiles.map((f) => normalizePath(relative(absDir, f)));

  if (pkg.files && pkg.files.length > 0) {
    // Use the `files` field — each entry can be a literal path, directory, or glob
    for (const pattern of pkg.files) {
      // First try as a literal file or directory
      const target = join(absDir, pattern);
      const resolved = resolve(target);
      if (!resolved.startsWith(absDir + sep) && resolved !== absDir) {
        consola.warn(`files pattern "${pattern}" escapes package directory, skipping`);
        continue;
      }
      let matched = false;
      try {
        const s = await stat(target);
        if (s.isDirectory()) {
          // Filter cached array by prefix instead of re-walking
          const prefix = normalizePath(relative(absDir, target)) + "/";
          for (let i = 0; i < allRelPaths.length; i++) {
            if (allRelPaths[i].startsWith(prefix)) {
              files.push(allFiles[i]);
            }
          }
          matched = true;
        } else {
          files.push(target);
          matched = true;
        }
      } catch (err) {
        if (isNodeError(err) && err.code !== "ENOENT") {
          throw err;
        }
        // Not a literal path — try as a glob pattern
      }

      if (!matched) {
        // Treat as glob pattern
        const isMatch = picomatch(pattern, { dot: true });
        let globMatched = 0;
        for (let i = 0; i < allRelPaths.length; i++) {
          if (isMatch(allRelPaths[i])) {
            const absFile = resolve(allFiles[i]);
            if (!absFile.startsWith(absDir + sep) && absFile !== absDir) continue;
            files.push(allFiles[i]);
            globMatched++;
          }
        }
        if (globMatched === 0) {
          consola.warn(`files pattern "${pattern}" matched no files`);
        }
      }
    }
  } else {
    // No `files` field — include everything except common ignores
    const ignoreMatchers = await loadNpmIgnore(absDir);
    for (let i = 0; i < allRelPaths.length; i++) {
      if (!shouldIgnore(allRelPaths[i], ignoreMatchers)) {
        files.push(allFiles[i]);
      }
    }
  }

  // Always include common root files (check tree walk result instead of stat)
  const fileSet = new Set(files);
  const allFileSet = new Set(allFiles);
  for (const name of ["README.md", "README", "LICENSE", "LICENCE", "CHANGELOG.md"]) {
    const p = join(absDir, name);
    if (fileSet.has(p)) continue;
    if (!allFileSet.has(p)) continue;
    files.push(p);
    fileSet.add(p);
  }

  // Deduplicate
  return [...fileSet];
}

/** Default directories/files to ignore when no `files` field */
const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  ".npmrc",
  ".knarr",
  "test",
  "tests",
  "__tests__",
  ".github",
  ".vscode",
  ".idea",
  "coverage",
  ".nyc_output",
  "tsconfig.json",
  "tsconfig.build.json",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".prettierrc",
  ".prettierrc.js",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js",
]);

interface IgnoreMatchers {
  literals: Set<string>;
  patterns: picomatch.Matcher[];
  negations: picomatch.Matcher[];
}

function shouldIgnore(relPath: string, matchers: IgnoreMatchers): boolean {
  // Check negation patterns first — user-defined negations in .npmignore
  // have highest precedence and override DEFAULT_IGNORES and other rules
  for (const isMatch of matchers.negations) {
    if (isMatch(relPath)) return false;
  }

  const parts = relPath.split(/[\\/]/);
  for (const part of parts) {
    if (DEFAULT_IGNORES.has(part)) return true;
    if (matchers.literals.has(part)) return true;
  }
  if (matchers.literals.has(relPath)) return true;
  for (const isMatch of matchers.patterns) {
    if (isMatch(relPath)) return true;
  }
  return false;
}

async function loadNpmIgnore(dir: string): Promise<IgnoreMatchers> {
  const matchers: IgnoreMatchers = { literals: new Set(), patterns: [], negations: [] };
  try {
    const content = await readFile(join(dir, ".npmignore"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed.startsWith("!")) {
        // Negation pattern — un-ignore
        const pat = trimmed.slice(1);
        if (hasGlobChars(pat)) {
          matchers.negations.push(picomatch(pat, { dot: true }));
        } else {
          // Negation of a literal isn't handled via Set, use a matcher
          matchers.negations.push(picomatch(pat, { dot: true }));
        }
      } else if (hasGlobChars(trimmed)) {
        matchers.patterns.push(picomatch(trimmed, { dot: true }));
      } else {
        matchers.literals.add(trimmed.replace(/\/$/, ""));
      }
    }
  } catch (err) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      throw err;
    }
    // no .npmignore
  }
  return matchers;
}

function hasGlobChars(pattern: string): boolean {
  return /[*?[\]{}()]/.test(pattern);
}

async function collectAllFiles(dir: string, rootDir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue; // skip .git at any depth
        if (dir === rootDir && entry.name === "node_modules") continue; // only skip top-level
        if (entry.isSymbolicLink()) continue; // skip symlinked directories
        results.push(...(await collectAllFiles(full, rootDir)));
      } else if (!entry.isSymbolicLink()) {
        results.push(full);
      }
      // else: skip symlinks to prevent escaping package boundary
    }
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // directory was removed during scan
      return [];
    }
    throw err;
  }
  return results;
}
