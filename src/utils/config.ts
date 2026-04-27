import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verbose } from "./logger.js";

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

/**
 * Load knarr configuration from package.json#knarr.
 */
export async function loadKnarrConfig(
  projectDir: string
): Promise<KnarrConfig> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const source = pkg.knarr;
    if (!source || typeof source !== "object") return {};

    const config: KnarrConfig = {};
    const p = source;

    if (typeof p.buildCmd === "string") config.buildCmd = p.buildCmd;
    if (Array.isArray(p.watchPatterns)) {
      config.watchPatterns = p.watchPatterns.filter(
        (v: unknown) => typeof v === "string"
      );
    }
    if (typeof p.debounce === "number" && Number.isFinite(p.debounce)) {
      config.debounce = p.debounce;
    }
    if (typeof p.cooldown === "number" && Number.isFinite(p.cooldown)) {
      config.cooldown = p.cooldown;
    }
    if (typeof p.historyLimit === "number" && Number.isFinite(p.historyLimit)) {
      config.historyLimit = Math.max(0, Math.floor(p.historyLimit));
    }
    if (typeof p.notify === "boolean") {
      config.notify = p.notify;
    }

    verbose(`[config] Loaded knarr config from package.json: ${JSON.stringify(config)}`);
    return config;
  } catch {
    return {};
  }
}
