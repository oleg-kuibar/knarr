import { isJsonOutput } from "./logger.js";
import { consola } from "./console.js";

export type MutationType =
  | "copy"
  | "remove"
  | "move"
  | "mkdir"
  | "write"
  | "bin-link"
  | "bin-unlink"
  | "cache-invalidate"
  | "lock-skip"
  | "lifecycle-skip"
  | "command-skip";

export interface DryRunMutation {
  type: MutationType;
  path: string;
  dest?: string;
  detail?: string;
}

const mutations: DryRunMutation[] = [];

/** Record a mutation that was skipped due to --dry-run */
export function recordMutation(mutation: DryRunMutation): void {
  mutations.push(mutation);
}

/** Print a summary of all recorded dry-run mutations */
export function printDryRunReport(): void {
  if (mutations.length === 0) {
    consola.info("[dry-run] No mutations would be performed");
    return;
  }

  if (isJsonOutput()) {
    console.log(JSON.stringify({ dryRun: true, mutations }, null, 2));
    return;
  }

  // Group by type
  const grouped = new Map<MutationType, DryRunMutation[]>();
  for (const m of mutations) {
    let list = grouped.get(m.type);
    if (!list) {
      list = [];
      grouped.set(m.type, list);
    }
    list.push(m);
  }

  consola.info(`\n[dry-run] ${mutations.length} mutation(s) would be performed:\n`);

  const labels: Record<MutationType, string> = {
    copy: "Copy",
    remove: "Remove",
    move: "Move",
    mkdir: "Create directory",
    write: "Write file",
    "bin-link": "Create bin link",
    "bin-unlink": "Remove bin link",
    "cache-invalidate": "Invalidate cache",
    "lock-skip": "Skip lock",
    "lifecycle-skip": "Skip lifecycle hook",
    "command-skip": "Skip command",
  };

  for (const [type, items] of grouped) {
    consola.info(`  ${labels[type]} (${items.length}):`);
    for (const item of items.slice(0, 20)) {
      const dest = item.dest ? ` → ${item.dest}` : "";
      const detail = item.detail ? ` (${item.detail})` : "";
      consola.info(`    ${item.path}${dest}${detail}`);
    }
    if (items.length > 20) {
      consola.info(`    ... and ${items.length - 20} more`);
    }
  }
}

/** Reset recorded mutations (for testing) */
export function resetMutations(): void {
  mutations.length = 0;
}
