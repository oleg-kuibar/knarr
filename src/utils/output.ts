import { consola } from "./console.js";
import { isJsonOutput } from "./logger.js";

/**
 * Print structured data. When --json is active, prints JSON to stdout.
 * When not, does nothing (human-readable output is handled by commands).
 */
export function output(data: unknown): void {
  if (isJsonOutput()) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Suppress human-readable consola output when --json is active.
 * Call at the start of each command's run().
 */
export function suppressHumanOutput(): void {
  if (isJsonOutput()) {
    consola.level = -1;
  }
}
