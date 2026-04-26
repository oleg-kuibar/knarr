import { consola } from "../utils/console.js";
import { buildWorkspaceGraph } from "../utils/workspace.js";
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

  const graph = await buildWorkspaceGraph(startDir);
  if (graph.packages.length === 0) {
    consola.warn("No workspace packages found");
    return;
  }

  let ordered: string[];
  try {
    ordered = topoSort(graph.adjacency);
  } catch (err) {
    if (err instanceof CycleError) {
      consola.error(`Cannot push: ${err.message}`);
      return;
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
      await doPush(dir, options);
      success++;
    } catch (err) {
      consola.warn(
        `Failed to push ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  consola.success(
    `Pushed ${success}/${ordered.length} packages in ${timer.elapsed()}${failed > 0 ? ` (${failed} failed)` : ""}`
  );
}
