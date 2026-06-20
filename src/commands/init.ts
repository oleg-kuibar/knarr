import { defineCommand } from "citty";
import { resolve, join, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { exists, ensureDir, atomicWriteFile } from "../utils/fs.js";
import {
  detectPackageManager,
  hasYarnPnpMarkers,
  isYarnPnpProject,
} from "../utils/pm-detect.js";
import { detectBundler } from "../utils/bundler-detect.js";
import { detectBuildCommand as detectBuildCmd } from "../utils/build-detect.js";
import { buildDevInstallCommand, runShellCommand } from "../utils/pm-commands.js";
import {
  ensureGitignore,
  addPostinstall,
  POSTINSTALL_RESTORE_COMMAND,
} from "../utils/init-helpers.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { isDryRun } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";
import { setKnarrBuildCmdIfMissing } from "../utils/config.js";
import {
  readConsumerState,
  writeConsumerState,
} from "../core/tracker.js";
import type { PackageManager } from "../types.js";

type ProjectRole = "consumer" | "library";

export default defineCommand({
  meta: {
    name: "init",
    description: "Set up knarr in the current project",
  },
  args: {
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip confirmation prompts",
      default: false,
    },
    role: {
      type: "string",
      description: 'Project role: "consumer" or "library"',
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const timer = new Timer();
    const projectDir = resolve(".");
    const skipPrompts = args.yes;
    let configUpdated = false;
    const nextSteps: string[] = [];
    consola.info(`Initializing knarr in ${pc.cyan(projectDir)}\n`);

    // 1. Detect and confirm package manager
    const detectedPm = await detectPackageManager(projectDir);
    consola.success(`Detected package manager: ${pc.cyan(detectedPm)}`);

    let pm = detectedPm;
    if (!skipPrompts) {
      const confirm = await consola.prompt(`Use ${detectedPm}?`, {
        type: "confirm",
        initial: true,
      });
      if (confirm === false) {
        const choices = (["npm", "pnpm", "yarn", "bun"] as const).filter(
          (p) => p !== detectedPm
        );
        const selected = await consola.prompt("Select package manager:", {
          type: "select",
          options: choices.map((p) => ({ label: p, value: p })),
        });
        if (typeof selected === "string") {
          pm = selected as typeof pm;
        }
      }
    }

    // 2. Select project role
    let role: ProjectRole = "consumer";
    if (args.role === "consumer" || args.role === "library") {
      role = args.role;
    } else if (!skipPrompts) {
      const selected = await consola.prompt(
        "How will you use knarr in this project?",
        {
          type: "select",
          options: [
            {
              label: "Consumer (app) - I want to link packages INTO this project",
              value: "consumer",
            },
            {
              label: "Library (package) - I want to publish this package FOR other projects",
              value: "library",
            },
          ],
        }
      );
      if (selected === "library") {
        role = "library";
      }
    }

    consola.success(`Project role: ${pc.cyan(role)}`);

    if (
      role === "consumer" &&
      (
        await hasYarnPnpMarkers(projectDir) ||
        (pm === "yarn" && await isYarnPnpProject(projectDir))
      )
    ) {
      consola.error(
        `Yarn PnP mode is not compatible with Knarr.\n\n` +
        `Knarr works by copying files into node_modules/, but PnP eliminates\n` +
        `node_modules/ entirely. To use Knarr with Yarn Berry, add one of these\n` +
        `to .yarnrc.yml:\n\n` +
        `  nodeLinker: node-modules\n` +
        `  nodeLinker: pnpm\n\n` +
        `Then run: yarn install`
      );
      process.exit(1);
    }

    // 3. Add .knarr/ to .gitignore
    const gitignorePath = join(projectDir, ".gitignore");
    const gitignoreUpdated = await ensureGitignore(gitignorePath);
    if (gitignoreUpdated) {
      consola.success("Added .knarr/ to .gitignore");
    }

    // 4. Add scripts based on role
    const pkgPath = join(projectDir, "package.json");
    let libraryBuildCmd: string | undefined;
    if (await exists(pkgPath)) {
      if (role === "consumer") {
        const postinstallAdded = await addPostinstall(pkgPath);
        if (postinstallAdded) {
          consola.success(
            `Added "postinstall": "${POSTINSTALL_RESTORE_COMMAND}" to package.json scripts`
          );
        }

        // Prompt for package name to link (skip when -y, user can add manually)
        if (!skipPrompts) {
          const input = await consola.prompt(
            "Package name to link (leave blank to skip):",
            { type: "text", default: "" }
          );
          if (typeof input === "string" && input.trim()) {
            const packageName = input.trim();
            const addScriptAdded = await addScript(
              pkgPath,
              "knarr:add",
              `knarr add ${packageName}`
            );
            if (addScriptAdded) {
              consola.success(
                `Added "knarr:add": "knarr add ${packageName}" to package.json scripts`
              );
            }
          }
        }
      } else {
        // Detect or prompt for build command
        libraryBuildCmd = await detectBuildCommand(pkgPath, pm, skipPrompts);
        configUpdated = await setKnarrBuildCmdIfMissing(pkgPath, libraryBuildCmd);
        if (configUpdated && libraryBuildCmd) {
          consola.success(`Saved build command to package.json#knarr.buildCmd`);
        }
        const added = await addLibraryScripts(pkgPath);
        for (const name of added) {
          consola.success(`Added "${name}" script to package.json`);
        }
      }
    }

    // 5. Create .knarr/ directory and state
    const knarrDir = join(projectDir, ".knarr");
    if (!(await exists(knarrDir))) {
      await ensureDir(knarrDir);
      await atomicWriteFile(
        join(knarrDir, "state.json"),
        JSON.stringify(
          { version: "1", packageManager: pm, role, links: {} },
          null,
          2
        )
      );
      consola.success("Created .knarr/ state directory");
    } else {
      // Update existing state with package manager and role
      const state = await readConsumerState(projectDir);
      state.packageManager = pm;
      state.role = role;
      await writeConsumerState(projectDir, state);
    }

    // 6. Detect bundler and auto-configure (consumers only)
    if (role === "consumer") {
      const bundler = await detectBundler(projectDir);
      if (bundler.type === "vite" && bundler.configFile) {
        consola.success(
          `Detected bundler: ${pc.cyan("Vite")} (${basename(bundler.configFile)})`
        );
        const { addKnarrVitePlugin } = await import("../utils/vite-config.js");
        const viteResult = await addKnarrVitePlugin(bundler.configFile);
        if (viteResult.modified) {
          consola.success(`Added knarr plugin to ${basename(bundler.configFile)}`);
          const installCmd = buildDevInstallCommand(pm, "knarr");
          consola.info(
            isDryRun()
              ? "[dry-run] Would install knarr as devDependency"
              : "Installing knarr as devDependency..."
          );
          const ok = await runShellCommand(installCmd, projectDir);
          if (ok && !isDryRun()) {
            consola.success("Installed knarr");
          } else if (!ok) {
            consola.warn(`Install failed. Run manually: ${installCmd}`);
          }
        } else if (viteResult.error) {
          consola.info(
            `Add the Vite plugin for automatic dev server restarts:\n` +
              `  ${pc.cyan('import knarr from "knarr/vite"')}\n` +
              `  ${pc.cyan("plugins: [knarr()]")}`
          );
        }
      } else if (bundler.type === "next" && bundler.configFile) {
        consola.success(
          `Detected bundler: ${pc.cyan("Next.js")} (${basename(bundler.configFile)})`
        );
        consola.info(
          `Next.js transpilePackages will be auto-configured when you run ${pc.cyan("knarr add")}`
        );
      } else if (bundler.type) {
        const names: Record<string, string> = {
          webpack: "Webpack",
          turbo: "Turbopack",
          rollup: "Rollup",
        };
        consola.success(
          `Detected bundler: ${pc.cyan(names[bundler.type] || bundler.type)} - no config needed, works out of the box`
        );
      }

      // Consumer next steps
      consola.log("");
      consola.info(`${pc.bold("Next steps:")}`);
      nextSteps.push("knarr use ../my-lib");
      nextSteps.push("cd ../my-lib && knarr dev");
      consola.log(`  1. ${pc.cyan(nextSteps[0])}                 <- publish + link a local package`);
      consola.log(`  2. ${pc.cyan(nextSteps[1])}          <- watch + rebuild + auto-push`);
    } else {
      // Library next steps
      consola.log("");
      consola.info(`${pc.bold("Next steps:")}`);
      nextSteps.push("knarr publish");
      nextSteps.push(`${pm} run knarr:dev`);
      nextSteps.push(`knarr use ${projectDir}`);
      consola.log(`  1. ${pc.cyan(nextSteps[0])}                    <- copy built files to knarr store`);
      consola.log(`  2. ${pc.cyan(nextSteps[1])}               <- watch + rebuild + auto-push to consumers`);
      consola.log(`  3. In consumer project: ${pc.cyan(nextSteps[2])}`);
    }

    consola.info(`Done in ${timer.elapsed()}`);
    output({
      packageManager: pm,
      role,
      buildCmd: libraryBuildCmd ?? null,
      configUpdated,
      nextSteps,
      elapsed: timer.elapsedMs(),
    });

    if (isDryRun()) printDryRunReport();
  },
});

/**
 * Add a single named script to package.json if it doesn't already exist.
 * Returns true if it was added.
 */
async function addScript(
  pkgPath: string,
  name: string,
  command: string
): Promise<boolean> {
  const content = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(content);

  if (pkg.scripts?.[name]) return false;

  if (!pkg.scripts) pkg.scripts = {};
  pkg.scripts[name] = command;

  const indent = content.match(/^(\s+)"/m)?.[1] || "  ";
  await atomicWriteFile(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
  return true;
}

/**
 * Detect the build command from package.json scripts, or prompt the user.
 * Delegates detection to the shared utility, wraps with interactive prompts.
 */
async function detectBuildCommand(
  pkgPath: string,
  pm: PackageManager,
  skipPrompts: boolean
): Promise<string | undefined> {
  const packageDir = join(pkgPath, "..");
  const detected = await detectBuildCmd(packageDir, pm);

  if (detected) {
    consola.success(`Detected build script: ${pc.cyan(detected)}`);
    return detected;
  }

  // No build script found - ask the user
  if (!skipPrompts) {
    consola.warn("No build script found in package.json");
    const input = await consola.prompt(
      "Build command (e.g. tsc, tsup, rollup -c):",
      { type: "text", default: "" }
    );
    if (typeof input === "string" && input.trim()) {
      return input.trim();
    }
  }

  consola.warn(
    `No build command saved - add a "build" script to package.json or configure package.json#knarr.buildCmd`
  );
  return undefined;
}

/**
 * Add library-mode scripts (knarr:publish, knarr:dev) to package.json.
 * Returns array of script names that were added.
 */
async function addLibraryScripts(
  pkgPath: string,
): Promise<string[]> {
  const added: string[] = [];

  if (await addScript(pkgPath, "knarr:publish", "knarr publish")) {
    added.push("knarr:publish");
  }

  if (
    await addScript(
      pkgPath,
      "knarr:dev",
      "knarr dev"
    )
  ) {
    added.push("knarr:dev");
  }

  return added;
}
