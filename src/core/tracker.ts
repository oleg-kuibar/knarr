import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { consola } from "../utils/console.js";
import type {
  ConsumerState,
  ConsumersRegistry,
  LinkEntry,
} from "../types.js";
import {
  getConsumersPath,
  getConsumerStatePath,
  getConsumerKnarrDir,
  normalizePath,
} from "../utils/paths.js";
import { ensureDir, ensurePrivateDir, exists, atomicWriteFile, isNodeError } from "../utils/fs.js";
import { withFileLock } from "../utils/lockfile.js";
import { isConsumerState, isConsumersRegistry } from "../utils/validators.js";
import { parseJson } from "../utils/json.js";

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
    const parsed = parseJson(content);
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
  await ensureDir(getConsumerKnarrDir(consumerPath));
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

function emptyRegistry(): ConsumersRegistry {
  return Object.create(null) as ConsumersRegistry;
}

/**
 * Read the global consumers registry with reliability information.
 * `reliable: false` means the file exists but is corrupt or unreadable, so
 * writing the returned (empty) registry back would drop registrations.
 */
export async function readConsumersRegistrySafe(): Promise<{
  registry: ConsumersRegistry;
  reliable: boolean;
}> {
  const regPath = getConsumersPath();
  try {
    const parsed = parseJson(await readFile(regPath, "utf-8"));
    if (!isConsumersRegistry(parsed)) {
      consola.warn(`Invalid consumers registry in ${regPath}, using empty registry`);
      return { registry: emptyRegistry(), reliable: false };
    }
    return { registry: Object.assign(emptyRegistry(), parsed), reliable: true };
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return { registry: emptyRegistry(), reliable: true };
    }
    consola.warn(`Failed to read consumers registry: ${err instanceof Error ? err.message : String(err)}`);
    return { registry: emptyRegistry(), reliable: false };
  }
}

/** Read the global consumers registry */
export async function readConsumersRegistry(): Promise<ConsumersRegistry> {
  return (await readConsumersRegistrySafe()).registry;
}

export function corruptRegistryHint(): string {
  return `Fix or delete ${getConsumersPath()}, then re-run 'knarr add' in each consumer project.`;
}

async function readConsumersRegistryForWrite(): Promise<ConsumersRegistry> {
  const { registry, reliable } = await readConsumersRegistrySafe();
  if (!reliable) {
    throw new Error(
      `Consumers registry ${getConsumersPath()} is corrupt; refusing to overwrite it. ${corruptRegistryHint()}`
    );
  }
  return registry;
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
    const registry = await readConsumersRegistryForWrite();
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
    const registry = await readConsumersRegistryForWrite();
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
export function cleanStaleConsumers(): Promise<{
  removedConsumers: number;
  removedPackages: number;
  removedMissingLinks: number;
  skippedUnreliableConsumers: number;
}>;
export function cleanStaleConsumers(options: {
  removeMissingLinks?: boolean;
}): Promise<{
  removedConsumers: number;
  removedPackages: number;
  removedMissingLinks: number;
  skippedUnreliableConsumers: number;
}>;
export async function cleanStaleConsumers(
  options: { removeMissingLinks?: boolean } = {}
): Promise<{
  removedConsumers: number;
  removedPackages: number;
  removedMissingLinks: number;
  skippedUnreliableConsumers: number;
}> {
  const regPath = getConsumersPath();
  let removedConsumers = 0;
  let removedPackages = 0;
  let removedMissingLinks = 0;
  let skippedUnreliableConsumers = 0;

  await withFileLock(regPath, async () => {
    const registry = await readConsumersRegistryForWrite();
    const updated = emptyRegistry();

    for (const [pkgName, consumers] of Object.entries(registry)) {
      const results = await Promise.all(
        consumers.map(async (consumerPath) => {
          if (!(await exists(consumerPath))) {
            return { consumerPath, valid: false, reason: "missing-dir" as const };
          }

          if (options.removeMissingLinks) {
            const { state, reliable } = await readConsumerStateSafe(consumerPath);
            if (!reliable) {
              skippedUnreliableConsumers++;
              return { consumerPath, valid: true, reason: "unreliable-state" as const };
            }
            if (!state.links[pkgName]) {
              return { consumerPath, valid: false, reason: "missing-link" as const };
            }
          }

          return { consumerPath, valid: true, reason: null };
        })
      );
      const validConsumers = results
        .filter((r) => r.valid)
        .map((r) => r.consumerPath);
      removedConsumers += consumers.length - validConsumers.length;
      removedMissingLinks += results.filter((r) => r.reason === "missing-link").length;
      if (validConsumers.length > 0) {
        updated[pkgName] = validConsumers;
      } else {
        removedPackages++;
      }
    }

    await writeConsumersRegistry(updated);
  });

  return {
    removedConsumers,
    removedPackages,
    removedMissingLinks,
    skippedUnreliableConsumers,
  };
}
