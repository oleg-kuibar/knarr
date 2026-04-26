import { defineCommand } from "citty";
import { resolve } from "node:path";
import { suppressHumanOutput } from "../utils/output.js";
import { doPush, startWatchMode, startMultiWatchMode } from "../core/push-engine.js";
import { doPushAll } from "../core/batch-push.js";
import { loadKnarrConfig } from "../utils/config.js";
import { isDryRun } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";

export default defineCommand({
  meta: {
    name: "dev",
    description:
      "Watch, rebuild, and push to all consumers. Auto-detects build command.",
  },
  args: {
    all: {
      type: "boolean",
      description: "Watch all workspace packages in dependency order",
      default: false,
    },
    build: {
      type: "string",
      description: "Override build command (default: auto-detect from package.json)",
    },
    "skip-build": {
      type: "boolean",
      description: "Watch output dirs directly, skip build command detection",
      default: false,
    },
    debounce: {
      type: "string",
      description: "Debounce delay in ms (default: 500)",
    },
    cooldown: {
      type: "string",
      description: "Minimum time between builds in ms (default: 500)",
    },
    "no-scripts": {
      type: "boolean",
      description: "Skip prepack/postpack lifecycle hooks",
      default: false,
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "Force copy all files, bypassing hash comparison",
      default: false,
    },
    notify: {
      type: "boolean",
      description: "Ring terminal bell on push completion",
      default: false,
    },
    "no-cascade": {
      type: "boolean",
      description: "Disable cascading rebuilds in --all mode",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const packageDir = resolve(".");
    const config = await loadKnarrConfig(packageDir);
    const pushOptions = {
      runScripts: !args["no-scripts"],
      force: args.force,
      historyLimit: config.historyLimit,
    };

    if (args.all) {
      // Initial push all workspace packages in topo order
      await doPushAll(packageDir, pushOptions);

      // Watch all workspace packages
      await startMultiWatchMode(packageDir, args, pushOptions);
    } else {
      const push = () => doPush(packageDir, pushOptions);

      // Initial push
      await push();
      if (isDryRun()) { printDryRunReport(); return; }

      // Start watching
      await startWatchMode(packageDir, args, push);
    }
  },
});
