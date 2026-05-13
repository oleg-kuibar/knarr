import { defineCommand } from "citty";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { exists, atomicWriteFile, removeDir } from "../utils/fs.js";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { isDryRun, isJsonOutput } from "../utils/logger.js";
import { printDryRunReport, recordMutation } from "../utils/dry-run.js";
import { addPackageToConsumer, readPackageNameFromSource } from "./add-flow.js";

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

interface MigrateOptions {
  yes?: boolean;
  from?: string;
}

export interface MigrateResult {
  migrated: boolean;
  packages: string[];
  linkedPackages: string[];
  plannedLinks: string[];
  elapsed: number;
}

export default defineCommand({
  meta: {
    name: "migrate",
    description: "Migrate from yalc to Knarr",
  },
  args: {
    from: {
      type: "string",
      description: "Path to a local package source to publish and link after cleanup",
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
    await runMigrate({
      yes: args.yes,
      from: args.from,
    });
  },
});

export async function runMigrate(options: MigrateOptions = {}): Promise<MigrateResult> {
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
    const result = {
      migrated: false,
      packages: [],
      linkedPackages: [],
      plannedLinks: [],
      elapsed: timer.elapsedMs(),
    };
    output(result);
    return result;
  }

  const packages = await readYalcPackages(yalcLockPath, hasYalcLock);

  if (!options.yes) {
    const confirmed = await consola.prompt(
      "Migrate from yalc to Knarr? This will modify package.json and remove .yalc/ and yalc.lock.",
      { type: "confirm" }
    );
    if (!confirmed || typeof confirmed === "symbol") {
      consola.info("Cancelled");
      const result = {
        migrated: false,
        packages,
        linkedPackages: [],
        plannedLinks: [],
        elapsed: timer.elapsedMs(),
      };
      output(result);
      return result;
    }
  }

  if (packages.length > 0) {
    consola.info(
      `Found ${packages.length} yalc-linked package(s): ${packages.map((p) => pc.cyan(p)).join(", ")}`
    );
  }

  await cleanupPackageJson(pkgPath);
  if (hasYalcDir) {
    await removeDir(yalcDir);
    consola.success("Removed .yalc/ directory");
  }
  if (hasYalcLock) {
    if (isDryRun()) {
      recordMutation({ type: "remove", path: yalcLockPath });
    } else {
      const { rm } = await import("node:fs/promises");
      await rm(yalcLockPath, { force: true });
    }
    consola.success("Removed yalc.lock");
  }

  const sources = await resolveMigrationSources(packages, options);
  const linkedPackages: string[] = [];
  const plannedLinks: string[] = [];

  if (sources.length > 0) {
    for (const source of sources) {
      const command = `knarr add ${source.packageName} --from ${source.sourcePath}`;
      if (isDryRun()) {
        recordMutation({ type: "command-skip", path: projectDir, detail: command });
        plannedLinks.push(command);
        continue;
      }

      await addPackageToConsumer({
        packageArg: source.packageName,
        from: source.sourcePath,
        yes: options.yes ?? false,
        emitOutput: false,
      });
      linkedPackages.push(source.packageName);
    }
  }

  consola.log("");
  consola.info(`${pc.bold("Migration complete!")} Next steps:\n`);
  if (sources.length === 0 || plannedLinks.length > 0) {
    consola.log(`  1. ${pc.cyan("knarr init")}`);
    const followUps = packages.length > 0 ? packages : ["<package>"];
    let index = 2;
    for (const pkg of followUps) {
      const command = plannedLinks.find((planned) => planned.includes(` ${pkg} `))
        ?? `knarr add ${pkg} --from <path-to-${pkg}>`;
      consola.log(`  ${index}. ${pc.cyan(command)}`);
      index++;
    }
  } else {
    consola.log(`  1. ${pc.cyan("knarr doctor --fix")}`);
    for (const source of sources) {
      consola.log(`  2. ${pc.cyan(`cd ${source.sourcePath} && knarr dev`)}`);
    }
  }
  consola.log(`\n  Run ${pc.cyan("knarr doctor")} to verify your setup.\n`);

  consola.info(`Migrated in ${timer.elapsed()}`);
  const result = {
    migrated: true,
    packages,
    linkedPackages,
    plannedLinks,
    elapsed: timer.elapsedMs(),
  };
  output(result);

  if (isDryRun()) printDryRunReport();
  return result;
}

async function readYalcPackages(
  yalcLockPath: string,
  hasYalcLock: boolean
): Promise<string[]> {
  if (!hasYalcLock) return [];

  try {
    const lockContent = await readFile(yalcLockPath, "utf-8");
    const lock = JSON.parse(lockContent) as YalcLock;
    return lock.packages ? Object.keys(lock.packages) : [];
  } catch {
    consola.warn("Could not parse yalc.lock - the file may be corrupted. Continuing with cleanup.");
    return [];
  }
}

async function cleanupPackageJson(pkgPath: string): Promise<void> {
  if (!(await exists(pkgPath))) return;

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

async function resolveMigrationSources(
  packages: string[],
  options: MigrateOptions
): Promise<Array<{ packageName: string; sourcePath: string }>> {
  if (options.from) {
    if (packages.length > 1) {
      consola.warn("--from is only used for one-package migrations; source paths are needed per package.");
      if (options.yes || isJsonOutput()) {
        return [];
      }
    } else {
      const sourcePath = resolve(options.from);
      const sourceName = await readPackageNameFromSource(sourcePath);
      if (packages.length === 1 && packages[0] !== sourceName) {
        consola.warn(
          `yalc.lock lists ${packages[0]}, but ${sourcePath} is ${sourceName}; linking ${sourceName}.`
        );
      }
      return [{ packageName: sourceName, sourcePath }];
    }
  }

  if (packages.length <= 1 || options.yes || isJsonOutput()) {
    return [];
  }

  const sources: Array<{ packageName: string; sourcePath: string }> = [];
  for (const packageName of packages) {
    const input = await consola.prompt(
      `Source path for ${packageName} (leave blank to skip):`,
      { type: "text", default: "" }
    );
    if (typeof input !== "string" || !input.trim()) continue;

    const sourcePath = resolve(input.trim());
    const sourceName = await readPackageNameFromSource(sourcePath);
    if (sourceName !== packageName) {
      consola.warn(
        `yalc.lock lists ${packageName}, but ${sourcePath} is ${sourceName}; linking ${sourceName}.`
      );
    }
    sources.push({ packageName: sourceName, sourcePath });
  }

  return sources;
}
