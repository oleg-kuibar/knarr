#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: lint each file Claude edits against the
 * project's secure-coding oxlint rules (.oxlintrc.json), and hand violations back to Claude
 * (exit code 2) so they get fixed in the same turn instead of in CI.
 *
 * Input: the hook payload as JSON on stdin ({ tool_input: { file_path } }).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINTED = /^(src|scripts|\.claude\/hooks)\/.+\.(ts|mts|js|mjs)$/;

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // not a payload we understand: never block the edit
}

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== "string") process.exit(0);

const rel = relative(root, resolve(filePath)).replaceAll("\\", "/");
if (rel.startsWith("..") || !LINTED.test(rel) || !existsSync(join(root, rel))) process.exit(0);

const oxlintBin = join(root, "node_modules", "oxlint", "bin", "oxlint");
if (!existsSync(oxlintBin)) process.exit(0); // dependencies not installed yet

// Run oxlint's JS launcher with this Node binary: no shell, no PATH lookup.
const result = spawnSync(process.execPath, [oxlintBin, rel], {
  cwd: root,
  encoding: "utf8",
  timeout: 55_000,
});

if (result.status === 0) process.exit(0);

process.stderr.write(
  `oxlint (secure-coding rules) failed for ${rel}. Fix these before continuing; ` +
    `see "Secure coding" in AGENTS.md.\n\n${result.stdout || ""}${result.stderr || ""}`
);
process.exit(2);
