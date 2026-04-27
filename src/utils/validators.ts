import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "./console.js";
import type {
  ConsumerState,
  KnarrMeta,
  ConsumersRegistry,
  LinkEntry,
} from "../types.js";

const PACKAGE_NAME_RE =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;

/**
 * Validate an npm package name before using it in store/node_modules paths.
 * This intentionally mirrors npm's modern lowercase package-name shape and
 * rejects path separators/traversal segments before any filesystem mutation.
 */
export function validatePackageName(name: string): void {
  if (
    !name ||
    name.length > 214 ||
    CONTROL_CHARS_RE.test(name) ||
    name.includes("\\") ||
    name.includes("//") ||
    name.split("/").some((part) => part === "." || part === "..") ||
    !PACKAGE_NAME_RE.test(name)
  ) {
    throw new Error(`Invalid package name "${name}"`);
  }
}

/** Validate a package.json version string before it becomes part of a path. */
export function validatePackageVersion(version: string): void {
  if (
    !version ||
    CONTROL_CHARS_RE.test(version) ||
    version.includes("/") ||
    version.includes("\\") ||
    version.includes("..") ||
    !SEMVER_RE.test(version)
  ) {
    throw new Error(`Invalid package version "${version}"`);
  }
}

export function validatePackageIdentity(name: string, version: string): void {
  validatePackageName(name);
  validatePackageVersion(version);
}

/** Check if a value is valid Knarr metadata. */
export function isKnarrMeta(value: unknown): value is KnarrMeta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.contentHash === "string" &&
    typeof v.publishedAt === "string" &&
    typeof v.sourcePath === "string" &&
    (v.buildId === undefined || typeof v.buildId === "string") &&
    (v.schemaVersion === undefined || typeof v.schemaVersion === "number")
  );
}

/** Check if a value is a valid LinkEntry */
export function isLinkEntry(value: unknown): value is LinkEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "string" &&
    typeof v.contentHash === "string" &&
    typeof v.linkedAt === "string" &&
    typeof v.sourcePath === "string" &&
    typeof v.backupExists === "boolean" &&
    typeof v.packageManager === "string" &&
    ["npm", "pnpm", "yarn", "bun"].includes(v.packageManager as string) &&
    (v.buildId === undefined || typeof v.buildId === "string")
  );
}

/** Check if a value is a valid ConsumerState */
export function isConsumerState(value: unknown): value is ConsumerState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== "1") return false;
  if (typeof v.links !== "object" || v.links === null) return false;
  const links = v.links as Record<string, unknown>;
  for (const entry of Object.values(links)) {
    if (!isLinkEntry(entry)) return false;
  }
  return true;
}

/**
 * Warn if the store version doesn't match the consumer's declared dependency range.
 * Uses a lightweight major-version check to avoid adding a semver dependency.
 */
export async function warnVersionMismatch(
  consumerPath: string,
  packageName: string,
  storeVersion: string,
): Promise<void> {
  try {
    const raw = await readFile(join(consumerPath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as Record<string, Record<string, string> | undefined>;
    const declared =
      pkg.dependencies?.[packageName] ??
      pkg.devDependencies?.[packageName] ??
      pkg.peerDependencies?.[packageName];
    if (!declared) return;

    // Skip workspace/catalog protocols and wildcards
    if (/^(workspace:|catalog:|\*)/.test(declared)) return;

    // Extract the version part from the range (strip ^, ~, >=, etc.)
    const match = declared.match(/(\d+)\.\d+\.\d+/);
    if (!match) return;

    const declaredMajor = parseInt(match[1], 10);
    const storeMajor = parseInt(storeVersion.split(".")[0], 10);

    if (declaredMajor !== storeMajor) {
      consola.warn(
        `Version mismatch: store has ${packageName}@${storeVersion} but your package.json declares "${declared}". Consider updating your dependency range.`
      );
    }
  } catch {
    // Non-critical — silently skip if package.json can't be read
  }
}

/** Check if a value is a valid ConsumersRegistry */
export function isConsumersRegistry(
  value: unknown
): value is ConsumersRegistry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const val of Object.values(v)) {
    if (!Array.isArray(val)) return false;
    for (const item of val) {
      if (typeof item !== "string") return false;
    }
  }
  return true;
}
