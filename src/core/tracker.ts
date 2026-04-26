import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { consola } from "../utils/console.js";
import type {
  ConsumerState,
  ConsumersRegistry,
  LinkEntry,
  PackageManager,
} from "../types.js";
import {
  getConsumersPath,
  getConsumerStatePath,
  getConsumerKNARRDir,
  normalizePath,
} from "../utils/paths.js";
import { ensureDir, ensurePrivateDir, exists, atomicWriteFile, isNodeError } from "../utils/fs.js";
import { withFileLock } from "../utils/lockfile.js";
import { isConsumerState, isConsumersRegistry } from "../utils/validators.js";

// ── Consumer State (.knarr/state.json in each consumer project) ──

/** Read the consumer state file, or return an empty state if not found */
export async function readConsumerState(
  consumerPath: string
): Promise<ConsumerState> {
  const { state } = await readConsumerStateSafe(consumerPath);
  return state;
}

/**
 * Read consumer state with reliability information.
 * Returns `reliable: true` when the state is trustworthy (valid file or ENOENT).
 * Returns `reliable: false` when the file exists but is corrupt/unreadable,
 * meaning the consumer might have links we can't see.
 */
export async function readConsumerStateSafe(
  consumerPath: string
): Promise<{ state: ConsumerState; reliable: boolean }> {
  const statePath = getConsumerStatePath(consumerPath);
  try {
    const content = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isConsumerState(parsed)) {
      consola.warn(`Invalid consumer state in ${statePath}, using defaults`);
      return { state: { version: "1", links: {} }, reliable: false };
    }
    return { state: parsed, reliable: true };
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      // No state file → no links, this is reliable
      return { state: { version: "1", links: {} }, reliable: true };
    }
    consola.warn(`Failed to read consumer state: ${err instanceof Error ? err.message : String(err)}`);
    return { state: { version: "1", links: {} }, reliable: false };
  }
}

/** Write the consumer state file */
export async function writeConsumerState(
  consumerPath: string,
  state: ConsumerState
): Promise<void> {
  await ensureDir(getConsumerKNARRDir(consumerPath));
  const statePath = getConsumerStatePath(consumerPath);
  await atomicWriteFile(statePath, JSON.stringify(state, null, 2));
}

/** Add or update a link entry in the consumer state */
export async function addLink(
  consumerPath: string,
  packageName: string,
  entry: LinkEntry
): Promise<void> {
  const statePath = getConsumerStatePath(consumerPath);
  await withFileLock(statePath, async () => {
    const { state, reliable } = await readConsumerStateSafe(consumerPath);
    if (!reliable) {
      throw new Error(
        `Consumer state in ${statePath} is corrupt — refusing to write to avoid destroying existing links. ` +
        `Delete .knarr/state.json and re-run 'knarr add' for each package.`
      );
    }
    state.links[packageName] = entry;
    await writeConsumerState(consumerPath, state);
  });
}

/** Remove a link entry from the consumer state */
export async function removeLink(
  consumerPath: string,
  packageName: string
): Promise<void> {
  const statePath = getConsumerStatePath(consumerPath);
  await withFileLock(statePath, async () => {
    const { state, reliable } = await readConsumerStateSafe(consumerPath);
    if (!reliable) {
      throw new Error(
        `Consumer state in ${statePath} is corrupt — refusing to write to avoid destroying existing links. ` +
        `Delete .knarr/state.json and re-run 'knarr add' for each package.`
      );
    }
    delete state.links[packageName];
    await writeConsumerState(consumerPath, state);
  });
}

/** Get a specific link entry */
export async function getLink(
  consumerPath: string,
  packageName: string
): Promise<LinkEntry | null> {
  const state = await readConsumerState(consumerPath);
  return state.links[packageName] ?? null;
}

// ── Global Consumers Registry (~/.knarr/consumers.json) ──

/** Read the global consumers registry */
export async function readConsumersRegistry(): Promise<ConsumersRegistry> {
  const regPath = getConsumersPath();
  try {
    const content = await readFile(regPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isConsumersRegistry(parsed)) {
      consola.warn(`Invalid consumers registry, using empty registry`);
      return {};
    }
    return parsed;
  } catch (err) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      consola.warn(`Failed to read consumers registry: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {};
  }
}

/** Write the global consumers registry */
async function writeConsumersRegistry(
  registry: ConsumersRegistry
): Promise<void> {
  const regPath = getConsumersPath();
  await ensurePrivateDir(dirname(getConsumersPath()));
  await atomicWriteFile(regPath, JSON.stringify(registry, null, 2));
}

/** Register a consumer for a package */
export async function registerConsumer(
  packageName: string,
  consumerPath: string
): Promise<void> {
  const regPath = getConsumersPath();
  await withFileLock(regPath, async () => {
    const registry = await readConsumersRegistry();
    if (!registry[packageName]) {
      registry[packageName] = [];
    }
    const normalized = normalizePath(consumerPath);
    if (!registry[packageName].includes(normalized)) {
      registry[packageName].push(normalized);
    }
    await writeConsumersRegistry(registry);
  });
}

/** Unregister a consumer for a package */
export async function unregisterConsumer(
  packageName: string,
  consumerPath: string
): Promise<void> {
  const regPath = getConsumersPath();
  await withFileLock(regPath, async () => {
    const registry = await readConsumersRegistry();
    if (!registry[packageName]) return;
    const normalized = normalizePath(consumerPath);
    registry[packageName] = registry[packageName].filter(
      (p) => p !== normalized
    );
    if (registry[packageName].length === 0) {
      delete registry[packageName];
    }
    await writeConsumersRegistry(registry);
  });
}

/** Get all consumers for a package */
export async function getConsumers(packageName: string): Promise<string[]> {
  const registry = await readConsumersRegistry();
  return registry[packageName] ?? [];
}

/**
 * Clean stale consumers — remove registrations for directories that no longer exist.
 * Returns the number of stale entries removed.
 */
export async function cleanStaleConsumers(): Promise<{
  removedConsumers: number;
  removedPackages: number;
}> {
  const regPath = getConsumersPath();
  let removedConsumers = 0;
  let removedPackages = 0;

  await withFileLock(regPath, async () => {
    const registry = await readConsumersRegistry();
    const updated: ConsumersRegistry = {};

    for (const [pkgName, consumers] of Object.entries(registry)) {
      const results = await Promise.all(
        consumers.map(async (consumerPath) => ({
          consumerPath,
          valid: await exists(consumerPath),
        }))
      );
      const validConsumers = results
        .filter((r) => r.valid)
        .map((r) => r.consumerPath);
      removedConsumers += consumers.length - validConsumers.length;
      if (validConsumers.length > 0) {
        updated[pkgName] = validConsumers;
      } else {
        removedPackages++;
      }
    }

    await writeConsumersRegistry(updated);
  });

  return { removedConsumers, removedPackages };
}
