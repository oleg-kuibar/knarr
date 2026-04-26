import { defineCommand } from "citty";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { listHistory, restoreHistoryEntry, resolveHistoryLimit } from "../core/history.js";
import { doPush } from "../core/push-engine.js";
import { loadKnarrConfig } from "../utils/config.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { errorWithSuggestion } from "../utils/errors.js";
import { isDryRun } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";
import type { PackageJson } from "../types.js";

export default defineCommand({
  meta: {
    name: "rollback",
    description: "Restore a previous build from history",
  },
  args: {
    "build-id": {
      type: "string",
      description: "Specific build ID to restore (default: previous build)",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip confirmation prompts",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const packageDir = resolve(".");

    let pkg: PackageJson;
    try {
      pkg = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf-8"));
    } catch {
      errorWithSuggestion("No package.json found in current directory");
      process.exit(1);
    }

    if (!pkg.name || !pkg.version) {
      errorWithSuggestion("package.json missing name or version field");
      process.exit(1);
    }

    const entries = await listHistory(pkg.name, pkg.version);
    if (entries.length === 0) {
      consola.info("No build history available");
      output({ rolledBack: false });
      return;
    }

    // Determine which build to restore
    let targetBuildId: string;
    if (args["build-id"]) {
      targetBuildId = args["build-id"];
      const found = entries.find((e) => e.buildId === targetBuildId);
      if (!found) {
        consola.error(`Build ${targetBuildId} not found in history`);
        consola.info("Available builds:");
        for (const entry of entries) {
          consola.log(
            `  ${pc.cyan(entry.buildId)}  ${pc.dim(entry.publishedAt)}`
          );
        }
        output({ rolledBack: false });
        return;
      }
    } else {
      // Default: previous build (most recent in history)
      targetBuildId = entries[0].buildId;
    }

    const target = entries.find((e) => e.buildId === targetBuildId)!;

    if (!args.yes) {
      const confirmed = await consola.prompt(
        `Restore build ${targetBuildId} (published ${target.publishedAt})?`,
        { type: "confirm" }
      );
      if (!confirmed || typeof confirmed === "symbol") {
        consola.info("Cancelled");
        return;
      }
    }

    const config = await loadKnarrConfig(packageDir);
    const limit = resolveHistoryLimit(config.historyLimit);
    const restored = await restoreHistoryEntry(pkg.name, pkg.version, targetBuildId, limit);

    if (!restored) {
      consola.error(`Failed to restore build ${targetBuildId}`);
      output({ rolledBack: false });
      return;
    }

    consola.success(
      `Restored ${pkg.name}@${pkg.version} to build ${targetBuildId}`
    );

    // Auto-push to all consumers
    try {
      await doPush(packageDir, { force: true });
    } catch (err) {
      consola.warn(
        `Push after rollback failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    output({ rolledBack: true, buildId: targetBuildId });

    if (isDryRun()) printDryRunReport();
  },
});
