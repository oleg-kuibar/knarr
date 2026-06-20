import { consola } from "./console.js";
import { isDryRun, isJsonOutput } from "./logger.js";
import { getMutations, markDryRunJsonReportPrinted } from "./dry-run.js";

/**
 * Print structured data. When --json is active, prints JSON to stdout.
 * When not, does nothing (human-readable output is handled by commands).
 */
export function output(data: unknown): void {
  if (isJsonOutput()) {
    if (isDryRun()) {
      markDryRunJsonReportPrinted();
      if (data && typeof data === "object" && !Array.isArray(data)) {
        console.log(JSON.stringify({
          ...(data as Record<string, unknown>),
          dryRun: true,
          mutations: getMutations(),
        }, null, 2));
      } else {
        console.log(JSON.stringify({ data, dryRun: true, mutations: getMutations() }, null, 2));
      }
      return;
    }
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
