import { consola } from "../utils/console.js";
import {
  buildReverseAdjacency,
  buildWorkspaceGraph,
  filterPublishableWorkspaceGraph,
} from "../utils/workspace.js";
import { topoSort, CycleError } from "../utils/topo-sort.js";
import { doPush } from "./push-engine.js";
import type { PushOptions } from "./push-engine.js";
import { Timer } from "../utils/timer.js";
import { verbose } from "../utils/logger.js";

export interface PushAllOptions extends PushOptions {
  /**
   * Workspace packages to skip before pushing. Used by watch-mode initial
   * builds so a failed build does not publish stale output.
   */
  skipPackages?: Iterable<string>;
}

/**
 * Push all workspace packages in topological (dependency-first) order.
 * Each package is published and injected sequentially to ensure
 * dependencies are available before dependents.
 */
export async function doPushAll(
  startDir: string,
  options: PushAllOptions = {}
): Promise<void> {
  const timer = new Timer();

  const discovered = await buildWorkspaceGraph(startDir);
  const graph = filterPublishableWorkspaceGraph(discovered);
  if (graph.packages.length === 0) {
    consola.warn("No publishable workspace packages found");
    return;
  }
  const privateCount = discovered.packages.length - graph.packages.length;
  if (privateCount > 0) {
    consola.info(`Skipping ${privateCount} private workspace package(s)`);
  }

  let ordered: string[];
  try {
    ordered = topoSort(graph.adjacency);
  } catch (err) {
    if (err instanceof CycleError) {
      consola.error(`Cannot push: ${err.message}`);
      throw err;
    }
    throw err;
  }

  // Map names back to directories
  const nameToDir = new Map(graph.packages.map((p) => [p.name, p.dir]));

  consola.info(`Pushing ${ordered.length} packages in dependency order`);
  verbose(`[batch-push] Order: ${ordered.join(" → ")}`);

  const reverseAdjacency = buildReverseAdjacency(graph.adjacency);
  const blocked = new Set(options.skipPackages ?? []);
  for (const name of [...blocked]) {
    markTransitiveDependentsBlocked(name, reverseAdjacency, blocked);
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const name of ordered) {
    const dir = nameToDir.get(name);
    if (!dir) continue;

    if (blocked.has(name)) {
      verbose(`[batch-push] Skipping ${name}: dependency build/push failed`);
      skipped++;
      continue;
    }

    try {
      const summary = await doPush(dir, options);
      if (summary.failedConsumers > 0) {
        failed++;
        markTransitiveDependentsBlocked(name, reverseAdjacency, blocked);
      } else {
        success++;
      }
    } catch (err) {
      consola.warn(
        `Failed to push ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
      markTransitiveDependentsBlocked(name, reverseAdjacency, blocked);
    }
  }

  const details = [
    failed > 0 ? `${failed} failed` : null,
    skipped > 0 ? `${skipped} skipped` : null,
  ].filter((part): part is string => part !== null);
  const summaryMessage =
    `Pushed ${success}/${ordered.length} packages in ${timer.elapsed()}` +
    (details.length > 0 ? ` (${details.join(", ")})` : "");
  if (failed > 0) {
    consola.warn(summaryMessage);
    throw new Error(`Failed to push ${failed} workspace package(s)`);
  }
  if (skipped > 0) {
    consola.warn(summaryMessage);
    return;
  }
  consola.success(summaryMessage);
}

function markTransitiveDependentsBlocked(
  name: string,
  reverseAdjacency: Map<string, Set<string>>,
  blocked: Set<string>
): void {
  for (const dependent of reverseAdjacency.get(name) ?? []) {
    if (blocked.has(dependent)) continue;
    blocked.add(dependent);
    markTransitiveDependentsBlocked(dependent, reverseAdjacency, blocked);
  }
}
