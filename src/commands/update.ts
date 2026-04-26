import { defineCommand } from "citty";
import { resolve } from "node:path";
import { consola } from "../utils/console.js";
import pLimit from "../utils/concurrency.js";
import { readConsumerState, addLink } from "../core/tracker.js";
import { findStoreEntry, getStoreEntry } from "../core/store.js";
import { inject } from "../core/injector.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { errorWithSuggestion } from "../utils/errors.js";
import { verbose } from "../utils/logger.js";
import { warnVersionMismatch } from "../utils/validators.js";
import type { LinkEntry } from "../types.js";

const updateLimit = pLimit(4);

export default defineCommand({
  meta: {
    name: "update",
    description: "Pull latest versions from the store for linked packages",
  },
  args: {
    package: {
      type: "positional",
      description: "Package name to update (default: all linked)",
      required: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const timer = new Timer();
    const consumerPath = resolve(".");
    const state = await readConsumerState(consumerPath);
    const links = Object.entries(state.links);

    if (links.length === 0) {
      consola.info("No linked packages in this project");
      output({ updated: 0, skipped: 0 });
      return;
    }

    // Filter to specific package if provided
    const toUpdate = args.package
      ? links.filter(([name]) => name === args.package)
      : links;

    if (args.package && toUpdate.length === 0) {
      errorWithSuggestion(`Package "${args.package}" is not linked in this project. Run 'knarr list' to see linked packages.`);
      process.exit(1);
    }

    let updated = 0;
    let skipped = 0;
    let missing = 0;
    let failed = 0;

    const results = await Promise.all(
      toUpdate.map(([packageName, link]) =>
        updateLimit(async () => {
          // Find the latest store entry for this package
          const entry = await findStoreEntry(packageName);
          if (!entry) {
            consola.warn(`Store entry missing for ${packageName}. Re-publish it.`);
            return "missing" as const;
          }

          // Check if content hash has changed
          if (entry.meta.contentHash === link.contentHash) {
            verbose(`[update] ${packageName}@${entry.version} already up to date`);
            return "skipped" as const;
          }

          try {
            // Inject the updated version
            const result = await inject(entry, consumerPath, link.packageManager);

            // Update link entry
            const updatedLink: LinkEntry = {
              ...link,
              version: entry.version,
              contentHash: entry.meta.contentHash,
              buildId: entry.meta.buildId ?? "",
              linkedAt: new Date().toISOString(),
            };
            await addLink(consumerPath, packageName, updatedLink);

            await warnVersionMismatch(consumerPath, packageName, entry.version);

            consola.success(
              `Updated ${packageName}@${entry.version} (${result.copied} files changed)`
            );
            return "updated" as const;
          } catch (err) {
            consola.warn(
              `Failed to update ${packageName}: ${err instanceof Error ? err.message : String(err)}`
            );
            return "failed" as const;
          }
        })
      )
    );

    for (const r of results) {
      if (r === "updated") updated++;
      else if (r === "skipped") skipped++;
      else if (r === "missing") missing++;
      else failed++;
    }

    const parts = [`${updated} updated`, `${skipped} unchanged`];
    if (missing > 0) parts.push(`${missing} missing`);
    if (failed > 0) parts.push(`${failed} failed`);
    consola.info(`Update complete: ${parts.join(", ")} in ${timer.elapsed()}`);
    output({ updated, skipped, missing, failed, elapsed: timer.elapsedMs() });
  },
});
