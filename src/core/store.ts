import { readFile, readdir } from "node:fs/promises";
import { consola } from "../utils/console.js";
import type { KnarrMeta, StoreEntry } from "../types.js";
import {
  getStorePath,
  getStoreEntryPath,
  getStorePackagePath,
  getStoreMetaPath,
  decodePackageName,
} from "../utils/paths.js";
import { ensurePrivateDir, exists, removeDir, atomicWriteFile, isNodeError } from "../utils/fs.js";
import { isKnarrMeta, validatePackageIdentity } from "../utils/validators.js";
import { parseJson } from "../utils/json.js";

/** Read the .knarr-meta.json for a store entry */
export async function readMeta(
  name: string,
  version: string
): Promise<KnarrMeta | null> {
  const metaPath = getStoreMetaPath(name, version);
  try {
    const content = await readFile(metaPath, "utf-8");
    const parsed = parseJson(content);
    if (!isKnarrMeta(parsed)) {
      consola.warn(`Invalid metadata for ${name}@${version}, ignoring`);
      return null;
    }
    return parsed;
  } catch (err) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      consola.warn(`Failed to read metadata for ${name}@${version}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** Write .knarr-meta.json for a store entry */
export async function writeMeta(
  name: string,
  version: string,
  meta: KnarrMeta
): Promise<void> {
  const metaPath = getStoreMetaPath(name, version);
  await ensurePrivateDir(getStoreEntryPath(name, version));
  await atomicWriteFile(metaPath, JSON.stringify(meta, null, 2));
}

/** Get a store entry if it exists */
export async function getStoreEntry(
  name: string,
  version: string
): Promise<StoreEntry | null> {
  const packageDir = getStorePackagePath(name, version);
  const meta = await readMeta(name, version);
  if (!meta) return null;
  if (!(await exists(packageDir))) return null;
  return { name, version, packageDir, meta };
}

/** Find a store entry by name (any version). Returns the latest by publishedAt. */
export async function findStoreEntry(
  name: string
): Promise<StoreEntry | null> {
  const matching = (await listStoreEntries()).filter((e) => e.name === name);
  if (matching.length === 0) return null;
  return matching.reduce((latest, entry) =>
    new Date(entry.meta.publishedAt).getTime() > new Date(latest.meta.publishedAt).getTime()
      ? entry : latest
  );
}

const PUBLISH_TEMP_SUFFIX = /\.(?:tmp-\d+|old)-(\d{13})$/;

export function publishTempDir(storeEntryDir: string, kind: "tmp" | "old"): string {
  const owner = kind === "tmp" ? `tmp-${process.pid}` : "old";
  return `${storeEntryDir}.${owner}-${Date.now()}`;
}

export function publishTempDirStartedAt(dirName: string): number | null {
  const startedAt = PUBLISH_TEMP_SUFFIX.exec(dirName)?.[1];
  return startedAt === undefined ? null : Number(startedAt);
}

function parseStoreDirName(dirName: string): { name: string; version: string } | null {
  if (publishTempDirStartedAt(dirName) !== null) return null;
  const atIdx = dirName.lastIndexOf("@");
  if (atIdx <= 0) return null;
  const name = decodePackageName(dirName.slice(0, atIdx));
  const version = dirName.slice(atIdx + 1);
  try {
    validatePackageIdentity(name, version);
  } catch {
    return null;
  }
  return { name, version };
}

/** List all entries in the store */
export async function listStoreEntries(): Promise<StoreEntry[]> {
  const storePath = getStorePath();
  if (!(await exists(storePath))) return [];

  const dirs = await readdir(storePath, { withFileTypes: true });
  const results = await Promise.all(
    dirs.map(async (dir) => {
      const identity = dir.isDirectory() ? parseStoreDirName(dir.name) : null;
      if (!identity) return null;
      const { name, version } = identity;
      const meta = await readMeta(name, version);
      if (!meta) return null;
      return {
        name,
        version,
        packageDir: getStorePackagePath(name, version),
        meta,
      } satisfies StoreEntry;
    })
  );

  return results.filter((r): r is StoreEntry => r !== null);
}

/** Remove a store entry */
export async function removeStoreEntry(
  name: string,
  version: string
): Promise<void> {
  await removeDir(getStoreEntryPath(name, version));
}
