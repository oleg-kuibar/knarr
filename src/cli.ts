import { availableParallelism } from "node:os";

// Expand libuv's threadpool to match available CPU cores.
// Must happen before any async I/O (fs, dns, crypto) is dispatched.
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(availableParallelism(), 8));

import { defineCommand, runMain } from "citty";
import { initFlags } from "./utils/logger.js";
import { showBanner } from "./utils/banner.js";
import { consola } from "./utils/console.js";

declare const __KNARR_VERSION__: string;

initFlags();

// Show banner when running without subcommand or with --help
const args = process.argv.slice(2);
const KNOWN_COMMANDS = [
  "init", "publish", "add", "use", "remove", "push", "dev",
  "restore", "list", "status", "update", "clean", "gc",
  "doctor", "migrate", "reset", "rollback", "check",
];
const hasSubcommand = args.some(
  (arg) => !arg.startsWith("-") && KNOWN_COMMANDS.includes(arg)
);
const hasHelpOrVersion = args.includes("--help") || args.includes("-h")
  || args.includes("--version");

if (!hasSubcommand && !hasHelpOrVersion && process.stdin.isTTY) {
  showBanner();
  const selected = await showInteractiveMenu();
  if (selected) {
    // Inject the selected subcommand so citty picks it up
    process.argv.splice(2, 0, selected);
  }
} else if (!hasSubcommand) {
  showBanner();
}

async function showInteractiveMenu(): Promise<string | null> {
  // Show brief status
  try {
    const { readConsumerStateSafe } = await import("./core/tracker.js");
    const { resolve } = await import("node:path");
    const { state } = await readConsumerStateSafe(resolve("."));
    const linkCount = Object.keys(state.links).length;
    if (linkCount > 0) {
      consola.info(`${linkCount} package(s) linked in this project`);
    }
  } catch {
    // Not in a consumer project, no status to show
  }

  const selected = await consola.prompt("What would you like to do?", {
    type: "select",
    options: [
      { label: "init     - Set up knarr in this project", value: "init" },
      { label: "publish  - Publish package to the knarr store", value: "publish" },
      { label: "add      - Link a package from the store", value: "add" },
      { label: "use      - Link a local package path", value: "use" },
      { label: "push     - Publish and push to all consumers", value: "push" },
      { label: "dev      - Watch, rebuild, and push continuously", value: "dev" },
      { label: "list     - Show linked packages", value: "list" },
      { label: "status   - Show project status", value: "status" },
      { label: "help     - Show help", value: "--help" },
    ],
  });

  return selected || null;
}

const main = defineCommand({
  meta: {
    name: "knarr",
    version: typeof __KNARR_VERSION__ !== "undefined" ? __KNARR_VERSION__ : "0.0.0-dev",
    description: "Local npm package development - copies built files into consumer node_modules",
  },
  args: {
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Enable verbose debug logging",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Preview changes without writing files",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output machine-readable JSON",
      default: false,
    },
  },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    publish: () => import("./commands/publish.js").then((m) => m.default),
    add: () => import("./commands/add.js").then((m) => m.default),
    use: () => import("./commands/use.js").then((m) => m.default),
    remove: () => import("./commands/remove.js").then((m) => m.default),
    push: () => import("./commands/push.js").then((m) => m.default),
    dev: () => import("./commands/dev.js").then((m) => m.default),
    restore: () => import("./commands/restore.js").then((m) => m.default),
    list: () => import("./commands/list.js").then((m) => m.default),
    status: () => import("./commands/status.js").then((m) => m.default),
    update: () => import("./commands/update.js").then((m) => m.default),
    clean: () => import("./commands/clean.js").then((m) => m.default),
    gc: () => import("./commands/clean.js").then((m) => m.default),
    doctor: () => import("./commands/doctor.js").then((m) => m.default),
    migrate: () => import("./commands/migrate.js").then((m) => m.default),
    reset: () => import("./commands/reset.js").then((m) => m.default),
    rollback: () => import("./commands/rollback.js").then((m) => m.default),
    check: () => import("./commands/check.js").then((m) => m.default),
  },
});

runMain(main);
