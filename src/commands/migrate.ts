import { defineCommand } from "citty";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { exists, atomicWriteFile, removeDir } from "../utils/fs.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { isDryRun } from "../utils/logger.js";
import { printDryRunReport, recordMutation } from "../utils/dry-run.js";

interface YalcLockEntry {
  version: string;
  file?: string;
  link?: string;
  replaced?: string;
  signature?: string;
}

interface YalcLock {
  version: string;
  packages: Record<string, YalcLockEntry>;
}

export default defineCommand({
  meta: {
    name: "migrate",
    description: "Migrate from yalc to Knarr",
  },
  args: {
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
    const projectDir = resolve(".");

    consola.info("Checking for yalc usage...\n");

    const yalcDir = join(projectDir, ".yalc");
    const yalcLockPath = join(projectDir, "yalc.lock");
    const pkgPath = join(projectDir, "package.json");

    const hasYalcDir = await exists(yalcDir);
    const hasYalcLock = await exists(yalcLockPath);

    if (!hasYalcDir && !hasYalcLock) {
      consola.info("No yalc usage detected in this project.");
      output({ migrated: false, packages: [] });
      return;
    }

    if (!args.yes) {
      const confirmed = await consola.prompt(
        "Migrate from yalc to Knarr? This will modify package.json and remove .yalc/ and yalc.lock.",
        { type: "confirm" }
      );
      if (!confirmed || typeof confirmed === "symbol") {
        consola.info("Cancelled");
        return;
      }
    }

    const packages: string[] = [];

    // 1. Read yalc.lock for linked packages
    if (hasYalcLock) {
      try {
        const lockContent = await readFile(yalcLockPath, "utf-8");
        const lock = JSON.parse(lockContent) as YalcLock;
        if (lock.packages) {
          packages.push(...Object.keys(lock.packages));
          consola.info(
            `Found ${packages.length} yalc-linked package(s): ${packages.map((p) => pc.cyan(p)).join(", ")}`
          );
        }
      } catch {
        consola.warn("Could not parse yalc.lock — the file may be corrupted. Continuing with cleanup.");
      }
    }

    // 2. Clean up package.json references to .yalc/
    if (await exists(pkgPath)) {
      try {
        const pkgContent = await readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);
        let changed = false;

        for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
          const deps = pkg[depField];
          if (!deps) continue;

          for (const [name, version] of Object.entries(deps)) {
            if (typeof version === "string" && version.includes(".yalc/")) {
              delete deps[name];
              changed = true;
              consola.info(`Removed file:.yalc/ reference for ${pc.cyan(name)}`);
            }
          }
        }

        if (changed) {
          const indent = pkgContent.match(/^(\s+)"/m)?.[1] || "  ";
          await atomicWriteFile(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
          consola.success("Cleaned up package.json");
        }
      } catch (err) {
        consola.warn(`Could not clean package.json: ${err instanceof Error ? err.message : String(err)}. You may need to manually remove file:.yalc/ references.`);
      }
    }

    // 3. Remove .yalc/ directory
    if (hasYalcDir) {
      await removeDir(yalcDir);
      consola.success("Removed .yalc/ directory");
    }

    // 4. Remove yalc.lock
    if (hasYalcLock) {
      if (isDryRun()) {
        recordMutation({ type: "remove", path: yalcLockPath });
      } else {
        const { rm } = await import("node:fs/promises");
        await rm(yalcLockPath, { force: true });
      }
      consola.success("Removed yalc.lock");
    }

    // 5. Show next steps
    consola.log("");
    consola.info(`${pc.bold("Migration complete!")} Next steps:\n`);
    consola.log(`  1. ${pc.cyan("knarr init")}`);
    if (packages.length > 0) {
      for (const pkg of packages) {
        consola.log(
          `  2. ${pc.cyan(`knarr add ${pkg} --from <path-to-${pkg}>`)}`
        );
      }
    }
    consola.log(
      `\n  Run ${pc.cyan("knarr doctor")} to verify your setup.\n`
    );

    consola.info(`Migrated in ${timer.elapsed()}`);
    output({
      migrated: true,
      packages,
      elapsed: timer.elapsedMs(),
    });

    if (isDryRun()) printDryRunReport();
  },
});
