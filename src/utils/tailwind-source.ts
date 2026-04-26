import { readFile, readdir } from "node:fs/promises";
import { atomicWriteFile } from "./fs.js";
import { join, dirname, relative } from "node:path";
import { normalizePath } from "./paths.js";

const IGNORED_DIRS = new Set(["node_modules", ".knarr", "dist", ".git"]);

/**
 * Find the first CSS file in a project that imports Tailwind v4.
 * Returns the absolute path or null.
 */
export async function findTailwindCss(
  projectRoot: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(projectRoot, { recursive: true, encoding: "utf-8" });
  } catch {
    return null;
  }

  const cssFiles = entries
    .filter((entry) => {
      if (!entry.endsWith(".css")) return false;
      // Skip ignored directories
      const parts = normalizePath(entry).split("/");
      return !parts.some((p) => IGNORED_DIRS.has(p));
    })
    .map((entry) => join(projectRoot, entry));

  for (const file of cssFiles) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    if (
      content.includes('@import "tailwindcss"') ||
      content.includes("@import 'tailwindcss'")
    ) {
      return file;
    }
  }

  return null;
}

/**
 * Add a `@source` directive for a Knarr-linked package to a Tailwind v4 CSS file.
 * Idempotent — skips if the directive already exists.
 */
export async function addTailwindSource(
  cssPath: string,
  packageName: string,
  projectRoot: string,
): Promise<{ modified: boolean; error?: string }> {
  let content: string;
  try {
    content = await readFile(cssPath, "utf-8");
  } catch {
    return { modified: false, error: "could not read CSS file" };
  }

  // Idempotency: check if @source for this package already exists
  if (content.includes(`node_modules/${packageName}`)) {
    return { modified: false };
  }

  const sourcePath = computeSourcePath(cssPath, packageName, projectRoot);

  // Find the last @import / @source / @plugin / @theme directive line
  const directiveRegex = /^@(import|source|plugin|theme)\s.+$/gm;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = directiveRegex.exec(content)) !== null) {
    lastMatch = match;
  }

  const sourceLine = `@source "${sourcePath}";`;

  if (lastMatch) {
    const insertPos = lastMatch.index + lastMatch[0].length;
    content =
      content.slice(0, insertPos) + "\n" + sourceLine + content.slice(insertPos);
  } else {
    // No directives found — prepend
    content = sourceLine + "\n" + content;
  }

  await atomicWriteFile(cssPath, content);
  return { modified: true };
}

/**
 * Remove a `@source` directive for a Knarr-linked package from a Tailwind v4 CSS file.
 */
export async function removeTailwindSource(
  cssPath: string,
  packageName: string,
): Promise<{ modified: boolean }> {
  let content: string;
  try {
    content = await readFile(cssPath, "utf-8");
  } catch {
    return { modified: false };
  }

  // Remove line matching @source containing node_modules/<packageName>
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sourceRegex = new RegExp(
    `^@source\\s+["'][^"']*node_modules/${escaped}["'];?\\s*\\n?`,
    "m",
  );

  if (!sourceRegex.test(content)) {
    return { modified: false };
  }

  content = content.replace(sourceRegex, "");
  await atomicWriteFile(cssPath, content);
  return { modified: true };
}

/**
 * Compute the relative path from the CSS file to the package in node_modules.
 * Always uses forward slashes.
 */
function computeSourcePath(
  cssPath: string,
  packageName: string,
  projectRoot: string,
): string {
  const cssDir = dirname(cssPath);
  const targetPath = join(projectRoot, "node_modules", packageName);
  return normalizePath(relative(cssDir, targetPath));
}
