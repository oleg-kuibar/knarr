import { defineCommand } from "citty";
import { resolve } from "node:path";
import { consola } from "../utils/console.js";
import pLimit from "../utils/concurrency.js";
import { readConsumerState, addLink } from "../core/tracker.js";
import { getStoreEntry } from "../core/store.js";
import { inject } from "../core/injector.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { isDryRun, verbose } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";
import { detectPackageManager, detectYarnNodeLinker, hasYarnrcYml } from "../utils/pm-detect.js";

const restoreLimit = pLimit(4);

export default defineCommand({
  meta: {
    name: "restore",
    description:
      "Re-inject all linked packages (use after npm install wipes overrides)",
  },
  args: {
    silent: {
      type: "boolean",
      description: "Suppress output when no packages are linked (for postinstall scripts)",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const timer = new Timer();
    const consumerPath = resolve(".");
    const state = await readConsumerState(consumerPath);

    // Check for Yarn PnP incompatibility
    const pm = await detectPackageManager(consumerPath);
    if (pm === "yarn") {
      const linker = await detectYarnNodeLinker(consumerPath);
      if (linker === "pnp" || (linker === null && await hasYarnrcYml(consumerPath))) {
        consola.error(
          `Yarn PnP mode is not compatible with Knarr.\n\n` +
          `Knarr works by copying files into node_modules/, but PnP eliminates\n` +
          `node_modules/ entirely. To use Knarr with Yarn Berry, add this to\n` +
          `.yarnrc.yml:\n\n` +
          `  nodeLinker: node-modules\n\n` +
          `Then run: yarn install`
        );
        process.exit(1);
      }
    }

    const links = Object.entries(state.links);
    if (links.length === 0) {
      if (!args.silent) {
        consola.info("No linked packages in this project");
      }
      output({ restored: 0, failed: 0 });
      return;
    }

    let restored = 0;
    let failed = 0;

    const results = await Promise.all(
      links.map(([packageName, link]) =>
        restoreLimit(async () => {
          const entry = await getStoreEntry(packageName, link.version);
          if (!entry) {
            consola.warn(
              `Store entry missing for ${packageName}@${link.version}. Re-publish it.`
            );
            return { packageName, success: false };
          }

          try {
            const result = await inject(entry, consumerPath, link.packageManager);
            // Update state so contentHash and linkedAt stay current
            await addLink(consumerPath, packageName, {
              ...link,
              contentHash: entry.meta.contentHash,
              buildId: entry.meta.buildId ?? "",
              linkedAt: new Date().toISOString(),
            });
            verbose(`[restore] ${packageName}@${link.version}: ${result.copied} files`);
            return { packageName, success: true, copied: result.copied };
          } catch (err) {
            consola.error(`Failed to restore ${packageName}: ${err instanceof Error ? err.message : String(err)}`);
            return { packageName, success: false };
          }
        })
      )
    );

    const failedPackages: string[] = [];
    for (const r of results) {
      if (r.success) {
        consola.success(
          `Restored ${r.packageName} (${(r as { copied: number }).copied} files)`
        );
        restored++;
      } else {
        failed++;
        failedPackages.push(r.packageName);
      }
    }

    consola.info(
      `Restore complete: ${restored} restored, ${failed} failed in ${timer.elapsed()}`
    );
    output({ restored, failed, failedPackages, elapsed: timer.elapsedMs() });

    if (isDryRun()) printDryRunReport();
  },
});
