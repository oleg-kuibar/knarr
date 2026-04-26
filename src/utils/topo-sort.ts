/**
 * Topological sort using Kahn's algorithm.
 * Used to order workspace packages so dependencies are processed first.
 */

export class CycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`Dependency cycle detected: ${cycle.join(" → ")}`);
    this.name = "CycleError";
    this.cycle = cycle;
  }
}

/**
 * Sort nodes topologically (dependency-first order).
 * @param graph Map of node → Set of its dependencies (nodes it depends on)
 * @returns Nodes in dependency-first order
 * @throws CycleError if a cycle is detected
 */
export function topoSort(graph: Map<string, Set<string>>): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  // Initialize all nodes
  for (const node of graph.keys()) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    if (!dependents.has(node)) dependents.set(node, []);
  }

  // Build in-degree counts and reverse adjacency
  for (const [node, deps] of graph) {
    for (const dep of deps) {
      // Only count edges to nodes that are in the graph
      if (!graph.has(dep)) continue;
      inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
      const list = dependents.get(dep);
      if (list) list.push(node);
      else dependents.set(dep, [node]);
    }
  }

  // Seed queue with nodes that have no in-graph dependencies
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    for (const dependent of dependents.get(node) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== graph.size) {
    // Find a cycle for the error message
    const remaining = [...graph.keys()].filter((n) => !sorted.includes(n));
    throw new CycleError(remaining);
  }

  return sorted;
}
