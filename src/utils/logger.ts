import { consola } from "./console.js";

let _verbose = false;
let _dryRun = false;
let _jsonOutput = false;

/**
 * Initialize global flags from process.argv.
 * Must be called before runMain() in cli.ts.
 */
export function initFlags(): void {
  _verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  _dryRun = process.argv.includes("--dry-run");
  _jsonOutput = process.argv.includes("--json");
  if (_verbose) consola.level = 4;
}

export function isVerbose(): boolean {
  return _verbose;
}

export function isDryRun(): boolean {
  return _dryRun;
}

export function isJsonOutput(): boolean {
  return _jsonOutput;
}

/** Log a debug message only when --verbose is active */
export function verbose(msg: string, ...args: unknown[]): void {
  if (_verbose) consola.debug(msg, ...args);
}
