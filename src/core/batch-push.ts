import { consola } from "../utils/console.js";
import { buildWorkspaceGraph, filterPublishableWorkspaceGraph } from "../utils/workspace.js";
import { topoSort, CycleError } from "../utils/topo-sort.js";
import { doPush } from "./push-engine.js";
import type { PushOptions } from "./push-engine.js";
import { Timer } from "../utils/timer.js";
import { verbose } from "../utils/logger.js";

/**
 * Push all workspace packages in topological (dependency-first) order.
 * Each package is published and injected sequentially to ensure
 * dependencies are available before dependents.
 */
export async function doPushAll(
  startDir: string,
  options: PushOptions = {}
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

  let success = 0;
  let failed = 0;

  for (const name of ordered) {
    const dir = nameToDir.get(name);
    if (!dir) continue;

    try {
      const summary = await doPush(dir, options);
      if (summary.failedConsumers > 0) {
        failed++;
      } else {
        success++;
      }
    } catch (err) {
      consola.warn(
        `Failed to push ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  const summaryMessage =
    `Pushed ${success}/${ordered.length} packages in ${timer.elapsed()}` +
    (failed > 0 ? ` (${failed} failed)` : "");
  if (failed > 0) {
    consola.warn(summaryMessage);
    throw new Error(`Failed to push ${failed} workspace package(s)`);
  }
  consola.success(summaryMessage);
}
