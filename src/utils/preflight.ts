import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verbose } from "./logger.js";

export type PreflightSeverity = "warn" | "error";

export interface PreflightIssue {
  code: string;
  severity: PreflightSeverity;
  message: string;
}

/**
 * Run pre-flight validation checks on a package before publishing.
 * Checks entry points, exports, types, and bin paths exist on disk.
 * Returns an array of issues found (empty = all good).
 */
export async function runPreflightChecks(
  packageDir: string
): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];

  let pkgContent: string;
  try {
    pkgContent = await readFile(join(packageDir, "package.json"), "utf-8");
  } catch {
    issues.push({
      code: "NO_PACKAGE_JSON",
      severity: "error",
      message: "No package.json found",
    });
    return issues;
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(pkgContent);
  } catch {
    issues.push({
      code: "INVALID_PACKAGE_JSON",
      severity: "error",
      message: "package.json is not valid JSON",
    });
    return issues;
  }

  const files = pkg.files as string[] | undefined;
  if (!files || files.length === 0) {
    issues.push({
      code: "EMPTY_FILES",
      severity: "warn",
      message:
        'No "files" field in package.json — npm will include almost everything. Consider adding a "files" field to control what gets published.',
    });
  }

  // Check main entry point
  if (typeof pkg.main === "string") {
    await checkPath(packageDir, pkg.main, "main", issues);
  }

  // Check module entry point
  if (typeof pkg.module === "string") {
    await checkPath(packageDir, pkg.module, "module", issues);
  }

  // Check types/typings
  if (typeof pkg.types === "string") {
    await checkPath(packageDir, pkg.types, "types", issues);
  } else if (typeof pkg.typings === "string") {
    await checkPath(packageDir, pkg.typings, "typings", issues);
  }

  // Check exports map paths
  if (typeof pkg.exports === "string") {
    await checkPath(packageDir, pkg.exports, "exports", issues);
  } else if (pkg.exports && typeof pkg.exports === "object") {
    await checkExports(packageDir, pkg.exports as Record<string, unknown>, issues);
  }

  // Check bin paths
  if (typeof pkg.bin === "string") {
    await checkPath(packageDir, pkg.bin, "bin", issues);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    for (const [name, binPath] of Object.entries(pkg.bin as Record<string, string>)) {
      if (typeof binPath === "string") {
        await checkPath(packageDir, binPath, `bin.${name}`, issues);
      }
    }
  }

  verbose(`[preflight] ${issues.length} issue(s) found in ${packageDir}`);
  return issues;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

async function checkPath(
  packageDir: string,
  filePath: string,
  field: string,
  issues: PreflightIssue[]
): Promise<void> {
  const resolved = resolve(packageDir, filePath);
  if (!(await fileExists(resolved))) {
    issues.push({
      code: "MISSING_PATH",
      severity: "warn",
      message: `"${field}" points to "${filePath}" which does not exist`,
    });
  }
}

/**
 * Recursively walk an exports map and check that all file paths exist.
 * Handles nested conditions (import/require/types/default).
 */
async function checkExports(
  packageDir: string,
  exports: Record<string, unknown>,
  issues: PreflightIssue[]
): Promise<void> {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "string") {
      // Direct path
      if (value.startsWith(".")) {
        const resolved = resolve(packageDir, value);
        if (!(await fileExists(resolved))) {
          issues.push({
            code: "EXPORTS_PATH_MISSING",
            severity: "warn",
            message: `exports["${key}"] points to "${value}" which does not exist`,
          });
        }
      }
    } else if (value && typeof value === "object") {
      // Nested conditions (import, require, types, default, etc.)
      await checkExportsConditions(
        packageDir,
        key,
        value as Record<string, unknown>,
        issues
      );
    }
  }
}

async function checkExportsConditions(
  packageDir: string,
  exportKey: string,
  conditions: Record<string, unknown>,
  issues: PreflightIssue[]
): Promise<void> {
  // Check types condition ordering: "types" should come before "import"/"require"/"default"
  const keys = Object.keys(conditions);
  const typesIdx = keys.indexOf("types");
  const importIdx = keys.indexOf("import");
  const requireIdx = keys.indexOf("require");
  const defaultIdx = keys.indexOf("default");

  if (typesIdx !== -1) {
    const firstCodeIdx = Math.min(
      importIdx === -1 ? Infinity : importIdx,
      requireIdx === -1 ? Infinity : requireIdx,
      defaultIdx === -1 ? Infinity : defaultIdx
    );
    if (typesIdx > firstCodeIdx && firstCodeIdx !== Infinity) {
      issues.push({
        code: "TYPES_CONDITION_ORDER",
        severity: "warn",
        message: `exports["${exportKey}"].types should come before import/require/default for TypeScript to resolve it correctly`,
      });
    }
  }

  for (const [condition, value] of Object.entries(conditions)) {
    if (typeof value === "string" && value.startsWith(".")) {
      const resolved = resolve(packageDir, value);
      if (!(await fileExists(resolved))) {
        issues.push({
          code: "EXPORTS_PATH_MISSING",
          severity: "warn",
          message: `exports["${exportKey}"].${condition} points to "${value}" which does not exist`,
        });
      }
    } else if (value && typeof value === "object") {
      await checkExportsConditions(
        packageDir,
        exportKey,
        value as Record<string, unknown>,
        issues
      );
    }
  }
}
