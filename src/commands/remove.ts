import { defineCommand } from "citty";
import { resolve, basename } from "node:path";
import { consola } from "../utils/console.js";
import { removeInjected, restoreBackup } from "../core/injector.js";
import { getLink, removeLink, readConsumerState } from "../core/tracker.js";
import { unregisterConsumer } from "../core/tracker.js";
import { detectBundler } from "../utils/bundler-detect.js";
import { removeFromTranspilePackages } from "../utils/nextjs-config.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { errorWithSuggestion } from "../utils/errors.js";
import { isDryRun, verbose } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";

export default defineCommand({
  meta: {
    name: "remove",
    description: "Remove a Knarr-linked package and restore the original",
  },
  args: {
    package: {
      type: "positional",
      description: "Package name to remove",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Remove all linked packages",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Skip error checking",
      default: false,
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
    const timer = new Timer();
    const consumerPath = resolve(".");

    if (args.all) {
      // Remove all linked packages
      const state = await readConsumerState(consumerPath);
      const links = Object.entries(state.links);

      if (links.length === 0) {
        consola.info("No linked packages to remove");
        output({ removed: 0 });
        return;
      }

      if (!args.yes) {
        const names = links.map(([name]) => name).join(", ");
        const confirmed = await consola.prompt(
          `Remove ${links.length} linked package(s)? (${names})`,
          { type: "confirm" }
        );
        if (!confirmed || typeof confirmed === "symbol") {
          consola.info("Cancelled");
          return;
        }
      }

      let removed = 0;
      let failed = 0;
      for (const [packageName, link] of links) {
        try {
          await removeSinglePackage(consumerPath, packageName, link);
          removed++;
        } catch (err) {
          failed++;
          consola.warn(
            `Failed to remove ${packageName}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      consola.success(`Removed ${removed} Knarr link(s)${failed > 0 ? `, ${failed} failed` : ""} in ${timer.elapsed()}`);
      output({ removed, failed, elapsed: timer.elapsedMs() });
      return;
    }

    // Single package removal
    const packageName = args.package;
    if (!packageName) {
      errorWithSuggestion("Package name required. Use --all to remove all linked packages.");
      process.exit(1);
    }

    const link = await getLink(consumerPath, packageName);
    if (!link) {
      if (args.force) {
        consola.warn(`Package "${packageName}" is not linked, skipping`);
        output({ removed: 0 });
        return;
      }
      errorWithSuggestion(`Package "${packageName}" is not linked in this project`);
      process.exit(1);
    }

    await removeSinglePackage(consumerPath, packageName, link);

    consola.success(`Removed Knarr link for ${packageName} in ${timer.elapsed()}`);
    output({ removed: 1, package: packageName, elapsed: timer.elapsedMs() });

    if (isDryRun()) printDryRunReport();
  },
});

export async function removeSinglePackage(
  consumerPath: string,
  packageName: string,
  link: { backupExists: boolean; packageManager: "npm" | "pnpm" | "yarn" | "bun" }
): Promise<void> {
  verbose(`[remove] Removing ${packageName}`);

  // Remove from node_modules
  await removeInjected(consumerPath, packageName, link.packageManager);

  // Restore backup if it exists
  if (link.backupExists) {
    try {
      const restored = await restoreBackup(
        consumerPath,
        packageName,
        link.packageManager
      );
      if (restored) {
        consola.success(`Restored original ${packageName} from backup`);
      }
    } catch (err) {
      consola.warn(
        `Failed to restore backup for ${packageName}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Run your package manager's install command to restore it.`
      );
    }
  }

  // Auto-update bundler configs
  const bundler = await detectBundler(consumerPath);
  if (bundler.type === "next" && bundler.configFile) {
    const result = await removeFromTranspilePackages(bundler.configFile, packageName);
    if (result.modified) {
      verbose(`[remove] Removed ${packageName} from ${basename(bundler.configFile)}`);
    }
  }

  // Remove @source for Tailwind v4
  const { findTailwindCss, removeTailwindSource } = await import("../utils/tailwind-source.js");
  const tailwindCss = await findTailwindCss(consumerPath);
  if (tailwindCss) {
    const twResult = await removeTailwindSource(tailwindCss, packageName);
    if (twResult.modified) {
      verbose(`[remove] Removed @source for ${packageName} from ${basename(tailwindCss)}`);
    }
  }

  // Update state (removeLink deletes entry before we check remaining links)
  await removeLink(consumerPath, packageName);
  await unregisterConsumer(packageName, consumerPath);

  // Remove Vite plugin if this was the last linked package
  if (bundler.type === "vite" && bundler.configFile) {
    const state = await readConsumerState(consumerPath);
    if (Object.keys(state.links).length === 0) {
      const { removeFromViteConfig } = await import("../utils/vite-config.js");
      const result = await removeFromViteConfig(bundler.configFile);
      if (result.modified) {
        verbose(`[remove] Removed Knarr plugin from ${basename(bundler.configFile)}`);
      }
    }
  }
}
