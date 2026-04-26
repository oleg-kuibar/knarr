import { defineCommand } from "citty";
import { resolve } from "node:path";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { readConsumerState, readConsumersRegistry } from "../core/tracker.js";
import { listHistory as listBuildHistory } from "../core/history.js";
import { listStoreEntries, getStoreEntry } from "../core/store.js";
import pLimit from "../utils/concurrency.js";
import { dirSize } from "../utils/fs.js";
import { formatBytes } from "../utils/format.js";
import { suppressHumanOutput, output } from "../utils/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List linked packages in current project or in the store",
  },
  args: {
    store: {
      type: "boolean",
      description: "List all packages in the global Knarr store",
      default: false,
    },
    history: {
      type: "boolean",
      description: "Show build history for linked packages",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    if (args.store) {
      await listStore();
    } else if (args.history) {
      await listHistory();
    } else {
      await listProject();
    }
  },
});

async function listProject() {
  const state = await readConsumerState(resolve("."));
  const links = Object.entries(state.links);

  if (links.length === 0) {
    consola.info("No linked packages in this project");
    output({ packages: [] });
    return;
  }

  consola.info(`Linked packages (${links.length}):\n`);

  // Check staleness in parallel
  const limit = pLimit(8);
  const packages = await Promise.all(
    links.map(([name, link]) =>
      limit(async () => {
        const storeEntry = await getStoreEntry(name, link.version);
        const stale = !!(storeEntry && storeEntry.meta.contentHash !== link.contentHash);
        return { name, version: link.version, buildId: link.buildId ?? null, stale, sourcePath: link.sourcePath };
      })
    )
  );

  for (const pkg of packages) {
    const buildTag = pkg.buildId ? `[${pkg.buildId}]` : "[--------]";
    const staleTag = pkg.stale ? pc.yellow(" (stale)") : "";
    consola.log(
      `  ${pc.cyan(pkg.name)} ${pc.dim("@" + pkg.version)} ${pc.dim(buildTag)}${staleTag}  ← ${pc.dim(pkg.sourcePath)}`
    );
  }
  output({ packages });
}

async function listStore() {
  const [entries, registry] = await Promise.all([
    listStoreEntries(),
    readConsumersRegistry(),
  ]);

  if (entries.length === 0) {
    consola.info("Knarr store is empty");
    output({ entries: [], totalSize: 0 });
    return;
  }

  // Measure sizes in parallel
  const sizeLimit = pLimit(8);
  const sizes = await Promise.all(
    entries.map((entry) => sizeLimit(() => dirSize(entry.packageDir)))
  );
  const totalSize = sizes.reduce((sum, s) => sum + s, 0);

  consola.info(`Store entries (${entries.length}, ${formatBytes(totalSize)} total):\n`);
  const storeEntries = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const size = sizes[i];
    const age = getRelativeTime(new Date(entry.meta.publishedAt));
    const buildTag = entry.meta.buildId ? `[${entry.meta.buildId}]` : "[--------]";
    const consumers = registry[entry.name]?.length ?? 0;
    const consumersTag = consumers > 0
      ? pc.green(`${consumers} consumer${consumers > 1 ? "s" : ""}`)
      : pc.dim("no consumers");
    consola.log(
      `  ${pc.cyan(entry.name)} ${pc.dim("@" + entry.version)} ${pc.dim(buildTag)}  ${pc.dim(formatBytes(size))}  ${pc.dim(`published ${age}`)}  ${consumersTag}`
    );
    consola.log(`    ${pc.dim(`from: ${entry.meta.sourcePath}`)}`);
    storeEntries.push({
      name: entry.name,
      version: entry.version,
      buildId: entry.meta.buildId ?? null,
      publishedAt: entry.meta.publishedAt,
      sourcePath: entry.meta.sourcePath,
      consumers,
      size,
    });
  }
  output({ entries: storeEntries, totalSize });
}

async function listHistory() {
  const state = await readConsumerState(resolve("."));
  const links = Object.entries(state.links);

  if (links.length === 0) {
    consola.info("No linked packages in this project");
    output({ packages: [] });
    return;
  }

  const allHistory: Record<string, unknown[]> = {};

  for (const [name, link] of links) {
    const entries = await listBuildHistory(name, link.version);
    consola.info(`${pc.cyan(name)} ${pc.dim("@" + link.version)} — ${entries.length} historical build(s)`);
    for (const entry of entries) {
      const age = getRelativeTime(new Date(entry.publishedAt));
      consola.log(
        `  ${pc.dim(entry.buildId)}  ${pc.dim(`published ${age}`)}`
      );
    }
    allHistory[name] = entries.map((e) => ({
      buildId: e.buildId,
      publishedAt: e.publishedAt,
      contentHash: e.contentHash,
    }));
  }

  output({ history: allHistory });
}

function getRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
