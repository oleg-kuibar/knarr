import { defineCommand } from "citty";
import { resolve } from "node:path";
import { consola } from "../utils/console.js";
import pLimit from "../utils/concurrency.js";
import { publish } from "../core/publisher.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { errorWithSuggestion } from "../utils/errors.js";
import { isDryRun, verbose } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";

const publishLimit = pLimit(4);

export default defineCommand({
  meta: {
    name: "publish",
    description: "Publish current package to the Knarr store",
  },
  args: {
    dir: {
      type: "positional",
      description: "Package directory (default: current directory)",
      required: false,
    },
    private: {
      type: "boolean",
      description: "Allow publishing private packages",
      default: false,
    },
    "no-scripts": {
      type: "boolean",
      description: "Skip prepack/postpack lifecycle hooks",
      default: false,
    },
    recursive: {
      type: "boolean",
      alias: "r",
      description: "Publish all packages in the workspace",
      default: false,
    },
    "no-check": {
      type: "boolean",
      description: "Skip pre-flight validation checks",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const timer = new Timer();
    const dir = resolve(args.dir || ".");

    const publishOpts = {
      allowPrivate: args.private,
      runScripts: !args["no-scripts"],
    };

    // Run pre-flight checks unless --no-check
    if (!args["no-check"] && !args.recursive) {
      const { runPreflightChecks } = await import("../utils/preflight.js");
      const issues = await runPreflightChecks(dir);
      for (const issue of issues) {
        if (issue.severity === "error") {
          consola.error(`[${issue.code}] ${issue.message}`);
        } else {
          consola.warn(`[${issue.code}] ${issue.message}`);
        }
      }
    }

    if (args.recursive) {
      verbose(`[publish] Discovering workspace packages from ${dir}`);
      const { findWorkspacePackages } = await import("../utils/workspace.js");
      const packages = await findWorkspacePackages(dir);

      if (packages.length === 0) {
        errorWithSuggestion(
          "No workspace packages found. Make sure you're in a workspace root or subdirectory."
        );
        process.exit(1);
      }

      let published = 0;
      let skipped = 0;
      let failed = 0;

      const results = await Promise.all(
        packages.map((pkgDir) =>
          publishLimit(async () => {
            try {
              const result = await publish(pkgDir, publishOpts);
              return result.skipped ? ("skipped" as const) : ("published" as const);
            } catch (err) {
              consola.warn(
                `Failed to publish ${pkgDir}: ${err instanceof Error ? err.message : String(err)}`
              );
              return "failed" as const;
            }
          })
        )
      );
      for (const r of results) {
        if (r === "published") published++;
        else if (r === "skipped") skipped++;
        else failed++;
      }

      consola.success(
        `Workspace publish: ${published} published, ${skipped} up to date, ${failed} failed`
      );
      output({
        recursive: true,
        packages: packages.length,
        published,
        skipped,
        failed,
        elapsed: timer.elapsedMs(),
      });
    } else {
      verbose(`[publish] Publishing from ${dir}`);
      try {
        const result = await publish(dir, publishOpts);
        output({ ...result, elapsed: timer.elapsedMs() });
      } catch (err) {
        errorWithSuggestion(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    if (isDryRun()) printDryRunReport();
  },
});
