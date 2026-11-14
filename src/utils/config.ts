import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verbose } from "./logger.js";
import { atomicWriteFile } from "./fs.js";
import { detectJsonIndent, objectField, parseJsonObject } from "./json.js";

/**
 * knarr configuration stored in package.json under the "knarr" key.
 * Provides persistent defaults for watch/build/dev behavior.
 */
export interface KnarrConfig {
  buildCmd?: string;
  watchPatterns?: string[];
  debounce?: number;
  cooldown?: number;
  historyLimit?: number;
  notify?: boolean;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Load knarr configuration from package.json#knarr. Every field is validated:
 * wrong types are ignored rather than trusted.
 */
export async function loadKnarrConfig(
  projectDir: string
): Promise<KnarrConfig> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    const source = objectField(parseJsonObject(raw, "package.json"), "knarr");
    if (!source) return {};

    const config: KnarrConfig = {};

    if (typeof source["buildCmd"] === "string") config.buildCmd = source["buildCmd"];
    const watchPatterns = source["watchPatterns"];
    if (Array.isArray(watchPatterns)) {
      config.watchPatterns = watchPatterns.filter((v): v is string => typeof v === "string");
    }
    const debounce = finiteNumber(source["debounce"]);
    if (debounce !== undefined) config.debounce = debounce;
    const cooldown = finiteNumber(source["cooldown"]);
    if (cooldown !== undefined) config.cooldown = cooldown;
    const historyLimit = finiteNumber(source["historyLimit"]);
    if (historyLimit !== undefined) config.historyLimit = Math.max(0, Math.floor(historyLimit));
    if (typeof source["notify"] === "boolean") config.notify = source["notify"];

    verbose(`[config] Loaded knarr config from package.json: ${JSON.stringify(config)}`);
    return config;
  } catch {
    return {};
  }
}

/**
 * Persist package.json#knarr.buildCmd without overwriting an existing value.
 * Returns true when package.json was updated.
 */
export async function setKnarrBuildCmdIfMissing(
  pkgPath: string,
  buildCmd: string | undefined
): Promise<boolean> {
  if (!buildCmd) return false;

  const raw = await readFile(pkgPath, "utf-8");
  const pkg = parseJsonObject(raw, pkgPath);
  const current = objectField(pkg, "knarr");

  if (current && typeof current["buildCmd"] === "string") {
    return false;
  }

  pkg["knarr"] = { ...current, buildCmd };

  await atomicWriteFile(pkgPath, JSON.stringify(pkg, null, detectJsonIndent(raw)) + "\n");
  return true;
}
