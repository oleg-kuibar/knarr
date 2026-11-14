import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import { isJsonOutput } from "./logger.js";
import { consola } from "./console.js";

/**
 * Shorten a path for the human report: relative to cwd when inside it,
 * `~` for the home directory (where the store usually lives). JSON keeps absolute paths.
 */
export function displayMutationPath(
  p: string,
  cwd: string = process.cwd(),
  home: string = homedir()
): string {
  const inside = (base: string) => {
    const rel = relative(base, p);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : rel === "" ? "." : null;
  };
  const fromCwd = inside(cwd);
  if (fromCwd !== null) return fromCwd;
  const fromHome = inside(home);
  if (fromHome !== null) return fromHome === "." ? "~" : `~${sep}${fromHome}`;
  return p;
}

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
let jsonReportPrinted = false;

/** Record a mutation that was skipped due to --dry-run */
export function recordMutation(mutation: DryRunMutation): void {
  mutations.push(mutation);
}

export function getMutations(): DryRunMutation[] {
  return [...mutations];
}

export function markDryRunJsonReportPrinted(): void {
  jsonReportPrinted = true;
}

/** Print a summary of all recorded dry-run mutations */
export function printDryRunReport(): void {
  if (mutations.length === 0) {
    consola.info("[dry-run] No mutations would be performed");
    return;
  }

  if (isJsonOutput()) {
    if (jsonReportPrinted) return;
    console.log(JSON.stringify({ dryRun: true, mutations }, null, 2));
    jsonReportPrinted = true;
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
      const dest = item.dest ? ` → ${displayMutationPath(item.dest)}` : "";
      const detail = item.detail ? ` (${item.detail})` : "";
      consola.info(`    ${displayMutationPath(item.path)}${dest}${detail}`);
    }
    if (items.length > 20) {
      consola.info(`    ... and ${items.length - 20} more`);
    }
  }
}

/** Reset recorded mutations (for testing) */
export function resetMutations(): void {
  mutations.length = 0;
  jsonReportPrinted = false;
}
