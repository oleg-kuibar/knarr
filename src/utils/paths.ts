import { homedir } from "node:os";
import { join } from "node:path";

/** Root knarr directory: ~/.knarr/ (override with KNARR_HOME env var). */
export function getKnarrHome(): string {
  return process.env.KNARR_HOME || join(homedir(), ".knarr");
}

/** Store root: ~/.knarr/store/ */
export function getStorePath(): string {
  return join(getKnarrHome(), "store");
}

/** Consumers registry: ~/.knarr/consumers.json */
export function getConsumersPath(): string {
  return join(getKnarrHome(), "consumers.json");
}

/** Global config: ~/.knarr/config.json */
export function getConfigPath(): string {
  return join(getKnarrHome(), "config.json");
}

/**
 * Encode a package name for use as a directory name.
 * Scoped packages: `@scope/name` -> `@scope+name`
 */
export function encodePackageName(name: string): string {
  return name.replace(/\//g, "+");
}

/**
 * Decode a directory name back to a package name.
 * `@scope+name` -> `@scope/name`
 */
export function decodePackageName(encoded: string): string {
  if (encoded.startsWith("@")) {
    const plusIdx = encoded.indexOf("+");
    if (plusIdx !== -1) {
      return encoded.slice(0, plusIdx) + "/" + encoded.slice(plusIdx + 1);
    }
  }
  return encoded;
}

/** Get the store directory for a specific package@version */
export function getStoreEntryPath(name: string, version: string): string {
  return join(getStorePath(), `${encodePackageName(name)}@${version}`);
}

/** Get the package directory within a store entry */
export function getStorePackagePath(name: string, version: string): string {
  return join(getStoreEntryPath(name, version), "package");
}

/** Get the .knarr-meta.json path for a store entry */
export function getStoreMetaPath(name: string, version: string): string {
  return join(getStoreEntryPath(name, version), ".knarr-meta.json");
}

/** Get the history directory for a store entry */
export function getStoreHistoryPath(name: string, version: string): string {
  return join(getStoreEntryPath(name, version), "history");
}

/** Get a specific history entry directory */
export function getHistoryEntryPath(
  name: string,
  version: string,
  buildId: string
): string {
  return join(getStoreHistoryPath(name, version), buildId);
}

/** Get the .knarr/ directory in a consumer project */
export function getConsumerKnarrDir(consumerPath: string): string {
  return join(consumerPath, ".knarr");
}

/** Get the state file in a consumer project */
export function getConsumerStatePath(consumerPath: string): string {
  return join(consumerPath, ".knarr", "state.json");
}

/** Get the backups directory in a consumer project */
export function getConsumerBackupPath(
  consumerPath: string,
  packageName: string
): string {
  return join(consumerPath, ".knarr", "backups", encodePackageName(packageName));
}

/** Normalize a file path to use forward slashes (for cross-platform consistency). */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Get node_modules/<pkg> path for a package in a consumer */
export function getNodeModulesPackagePath(
  consumerPath: string,
  packageName: string
): string {
  return join(consumerPath, "node_modules", packageName);
}
