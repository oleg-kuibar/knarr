import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "./fs.js";

/**
 * Detect the indentation style used in a file.
 */
function detectIndent(content: string): string {
  const match = content.match(/^(\s+)\S/m);
  return match?.[1] || "  ";
}

/**
 * Check if the content already has the knarr Vite plugin configured.
 */
function hasKnarrPlugin(content: string): boolean {
  return (
    content.includes("knarr/vite") ||
    content.includes("vite-plugin-knarr") ||
    content.includes("@olegkuibar/plunk/vite")
  );
}

function defineConfigUsesTernary(content: string): boolean {
  const callRegex = /(^|[^A-Za-z0-9_$])defineConfig\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callRegex.exec(content)) !== null) {
    const parenStart = match.index + match[0].length - 1;

    let depth = 1;
    let i = parenStart + 1;
    let inString: string | false = false;
    let escaped = false;

    while (i < content.length && depth > 0) {
      const ch = content[i];

      if (escaped) {
        escaped = false;
        i++;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        i++;
        continue;
      }

      if (inString) {
        if (ch === inString) inString = false;
        i++;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        i++;
        continue;
      }

      if (ch === "/" && content[i + 1] === "/") {
        const newline = content.indexOf("\n", i);
        i = newline === -1 ? content.length : newline + 1;
        continue;
      }

      if (ch === "/" && content[i + 1] === "*") {
        const end = content.indexOf("*/", i + 2);
        i = end === -1 ? content.length : end + 2;
        continue;
      }

      if (ch === "?") {
        const next = content[i + 1];
        if (next === "." || next === "?") {
          i += 2;
          continue;
        }
        return true;
      }
      if (ch === "(") depth++;
      if (ch === ")") depth--;

      i++;
    }
    callRegex.lastIndex = i;
  }

  return false;
}

/**
 * Parse comma-separated plugin entries, handling nested parentheses.
 * e.g. "react(), svelte({ hot: true })" → ["react()", "svelte({ hot: true })"]
 */
function parsePluginItems(str: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;

  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;

    if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);

  return items;
}

/**
 * Format plugin items into a plugins array literal.
 */
function formatPlugins(items: string[], indent: string): string {
  if (items.length === 0) return "[]";
  if (items.length === 1) return `[${items[0]}]`;
  const inner = items.map((i) => `${indent}${indent}${i},`).join("\n");
  return `[\n${inner}\n${indent}]`;
}

/**
 * Find the `plugins: [...]` array in config content using balanced bracket
 * scanning. Handles nested `[]`, `()`, `{}`, string literals, and comments.
 * Returns the start index of `[`, end index after `]`, and the inner content.
 */
function findPluginsArray(
  content: string
): { start: number; end: number; inner: string } | null {
  // Find "plugins" followed by ":" and then "["
  const keyRegex = /plugins\s*:\s*\[/g;
  const match = keyRegex.exec(content);
  if (!match) return null;

  const bracketStart = match.index + match[0].length - 1; // index of '['
  let depth = 1;
  let i = bracketStart + 1;
  let inString: string | false = false;
  let escaped = false;

  while (i < content.length && depth > 0) {
    const ch = content[i];

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      i++;
      continue;
    }

    // Handle string literals
    if (inString) {
      if (ch === inString) inString = false;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }

    // Skip line comments
    if (ch === "/" && content[i + 1] === "/") {
      const newline = content.indexOf("\n", i);
      i = newline === -1 ? content.length : newline + 1;
      continue;
    }

    // Skip block comments
    if (ch === "/" && content[i + 1] === "*") {
      const end = content.indexOf("*/", i + 2);
      i = end === -1 ? content.length : end + 2;
      continue;
    }

    // Track bracket depth (all types)
    if (ch === "[" || ch === "(" || ch === "{") depth++;
    if (ch === "]" || ch === ")" || ch === "}") depth--;

    i++;
  }

  if (depth !== 0) return null;

  return {
    start: bracketStart,
    end: i,
    inner: content.slice(bracketStart + 1, i - 1),
  };
}

/**
 * Find the end position of the last import statement, handling multi-line
 * imports like `import { foo,\n  bar } from "..."`.
 */
function findLastImportEnd(content: string): number {
  let lastEnd = 0;
  const importRegex = /^import\s/gm;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const start = match.index;
    // Find the end of this import — look for the semicolon or newline after `from "..."`
    // Handle multi-line: scan for closing quote after `from`
    let pos = start + match[0].length;

    // Simple approach: find the next unquoted semicolon or end of statement
    let inString: string | false = false;
    let braceDepth = 0;
    while (pos < content.length) {
      const ch = content[pos];

      if (inString) {
        if (ch === inString) inString = false;
        pos++;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        pos++;
        continue;
      }

      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;

      // End of import: semicolon at top level, or newline after from "..."
      if (ch === ";" && braceDepth <= 0) {
        pos++;
        break;
      }

      // Newline after closing quote (no semicolon style)
      if (ch === "\n" && braceDepth <= 0) {
        // Check if previous non-whitespace was a quote (end of from "...")
        const before = content.slice(start, pos).trimEnd();
        if (before.endsWith('"') || before.endsWith("'")) {
          break;
        }
        // Otherwise it's a multi-line import, continue
      }

      pos++;
    }

    lastEnd = pos;
  }

  return lastEnd;
}

/**
 * Heuristic to detect configs that are too complex for automatic rewriting.
 * Returns null if safe to rewrite, or a reason string if too complex.
 */
export function isComplexConfig(content: string): { complex: boolean; reason?: string } {
  // Conditional config: ternary with defineConfig
  if (defineConfigUsesTernary(content)) {
    return { complex: true, reason: "conditional defineConfig" };
  }

  // Dynamic export: export default function, or factory pattern
  if (/export\s+default\s+function/.test(content)) {
    return { complex: true, reason: "dynamic export (function)" };
  }

  // Spread into plugins: plugins: [...otherPlugins, ...]
  if (/plugins\s*:\s*\[\s*\.\.\./.test(content)) {
    return { complex: true, reason: "spread operator in plugins array" };
  }

  // Wrapper function: mergeConfig, defineConfig(async () => ...)
  if (/defineConfig\s*\(\s*async/.test(content) || /mergeConfig\s*\(/.test(content)) {
    return { complex: true, reason: "async or merged config" };
  }

  return { complex: false };
}

/**
 * Add the knarr Vite plugin import and plugin call to a Vite config file.
 * Returns { modified: true } on success, { modified: false, error } on failure.
 */
export async function addKnarrVitePlugin(
  configPath: string,
): Promise<{ modified: boolean; error?: string }> {
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch {
    return { modified: false, error: "could not read config file" };
  }

  if (hasKnarrPlugin(content)) {
    return { modified: false }; // already configured
  }

  // Check complexity before attempting rewrite
  const complexity = isComplexConfig(content);
  if (complexity.complex) {
    return { modified: false, error: `config too complex (${complexity.reason})` };
  }

  const indent = detectIndent(content);

  // Phase 1: Add knarr() to plugins array
  const pluginsArr = findPluginsArray(content);

  if (pluginsArr) {
    const items = parsePluginItems(pluginsArr.inner);
    items.push("knarr()");
    const newPlugins = formatPlugins(items, indent);
    content =
      content.slice(0, pluginsArr.start) +
      newPlugins +
      content.slice(pluginsArr.end);
  } else {
    // Pattern 2: config object exists but no plugins array
    const configObjRegex =
      /(?:defineConfig\s*\(\s*\{|export\s+default\s+\{)/;
    const configObjMatch = configObjRegex.exec(content);

    if (configObjMatch) {
      const insertPos = configObjMatch.index + configObjMatch[0].length;
      const newSection = `\n${indent}plugins: [knarr()],`;
      content =
        content.slice(0, insertPos) + newSection + content.slice(insertPos);
    } else {
      return {
        modified: false,
        error: "unrecognized Vite config pattern",
      };
    }
  }

  // Phase 2: Add import statement after the last existing import
  const importLine = `import knarr from "knarr/vite";\n`;
  const lastEnd = findLastImportEnd(content);

  if (lastEnd > 0) {
    // Insert after last import
    content =
      content.slice(0, lastEnd) +
      "\n" +
      importLine +
      content.slice(lastEnd);
  } else {
    // No imports found — prepend
    content = importLine + "\n" + content;
  }

  await atomicWriteFile(configPath, content);
  return { modified: true };
}

/**
 * Remove the knarr Vite plugin from a config file.
 * Removes the import line and the knarr() call from the plugins array.
 */
export async function removeFromViteConfig(
  configPath: string,
): Promise<{ modified: boolean }> {
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch {
    return { modified: false };
  }

  if (!hasKnarrPlugin(content)) {
    return { modified: false };
  }

  let modified = false;

  // Remove the import line
  const importRegex =
    /^import\s+\w+\s+from\s+["'](?:knarr|@olegkuibar\/plunk)\/vite["'];?\s*\n?/m;
  if (importRegex.test(content)) {
    content = content.replace(importRegex, "");
    modified = true;
  }

  // Remove knarr() from plugins array using balanced bracket parser
  const pluginsArr = findPluginsArray(content);
  if (pluginsArr) {
    const items = parsePluginItems(pluginsArr.inner);
    const filtered = items.filter(
      (item) => !item.startsWith("knarr(") && !item.startsWith("plunk("),
    );
    if (filtered.length !== items.length) {
      const indent = detectIndent(content);
      const newPlugins = formatPlugins(filtered, indent);
      content =
        content.slice(0, pluginsArr.start) +
        newPlugins +
        content.slice(pluginsArr.end);
      modified = true;
    }
  }

  if (modified) {
    await atomicWriteFile(configPath, content);
  }

  return { modified };
}

export const addKNARRVitePlugin = addKnarrVitePlugin;
export const addPlunkVitePlugin = addKnarrVitePlugin;
