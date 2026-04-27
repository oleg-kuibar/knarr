import { spawn } from "node:child_process";
import { platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { consola } from "../utils/console.js";
import { findStoreEntry, getStoreEntry } from "../core/store.js";
import { publish } from "../core/publisher.js";
import { inject, backupExisting, checkMissingDeps } from "../core/injector.js";
import { addLink, registerConsumer, getLink } from "../core/tracker.js";
import { exists } from "../utils/fs.js";
import { detectPackageManager, detectYarnNodeLinker, hasYarnrcYml } from "../utils/pm-detect.js";
import { detectBundler } from "../utils/bundler-detect.js";
import { ensureConsumerInit } from "../utils/init-helpers.js";
import { addToTranspilePackages } from "../utils/nextjs-config.js";
import { getConsumerStatePath } from "../utils/paths.js";
import { Timer } from "../utils/timer.js";
import { output } from "../utils/output.js";
import { errorWithSuggestion } from "../utils/errors.js";
import { isDryRun, verbose, isJsonOutput } from "../utils/logger.js";
import { printDryRunReport, recordMutation } from "../utils/dry-run.js";
import { warnVersionMismatch } from "../utils/validators.js";
import {
  validatePackageName as validatePackageNameStrict,
  validatePackageVersion,
} from "../utils/validators.js";
import type { LinkEntry, PackageManager } from "../types.js";

interface AddPackageOptions {
  packageArg: string;
  from?: string;
  yes?: boolean;
  timer?: Timer;
}

export async function addPackageToConsumer(options: AddPackageOptions): Promise<void> {
  const timer = options.timer ?? new Timer();
  const consumerPath = resolve(".");
  const { name: packageName, version: pinnedVersion } = parsePackageArg(options.packageArg);

  validatePackageNameArg(packageName, options.packageArg);
  if (pinnedVersion) {
    try {
      validatePackageVersion(pinnedVersion);
    } catch {
      errorWithSuggestion(`Invalid package version "${pinnedVersion}" in "${options.packageArg}".`);
      process.exit(1);
    }
  }

  if (options.from) {
    const fromPath = resolve(options.from);
    consola.info(`Publishing from ${fromPath}...`);
    await publish(fromPath);
  }

  const entry = pinnedVersion
    ? await getStoreEntry(packageName, pinnedVersion)
    : await findStoreEntry(packageName);
  if (!entry) {
    const versionHint = pinnedVersion ? `@${pinnedVersion}` : "";
    errorWithSuggestion(
      `Package "${packageName}${versionHint}" not found in store. Run 'knarr publish' in the package directory first, or use --from <path>.`
    );
    process.exit(1);
  }

  const needsInit = !(await exists(getConsumerStatePath(consumerPath)));
  const pm = await detectPackageManager(consumerPath);
  if (needsInit) {
    await ensureConsumerInit(consumerPath, pm);
    consola.success("Auto-initialized knarr (consumer mode)");
  }
  consola.info(`Detected package manager: ${pm}`);

  if (pm === "yarn") {
    const linker = await detectYarnNodeLinker(consumerPath);
    if (linker === "pnp" || (linker === null && await hasYarnrcYml(consumerPath))) {
      consola.error(
        `Yarn PnP mode is not compatible with knarr.\n\n` +
        `knarr works by copying files into node_modules/, but PnP eliminates\n` +
        `node_modules/ entirely. To use knarr with Yarn Berry, add this to\n` +
        `.yarnrc.yml:\n\n` +
        `  nodeLinker: node-modules\n\n` +
        `Then run: yarn install`
      );
      process.exit(1);
    }
  }

  const existingLink = await getLink(consumerPath, packageName);
  if (existingLink) {
    if (existingLink.version === entry.version) {
      consola.info(`Updating ${packageName}@${entry.version} (already linked)`);
    } else {
      consola.info(`Updating ${packageName}: ${existingLink.version} -> ${entry.version}`);
    }
  }

  const hasBackup = await backupExisting(consumerPath, packageName, pm);
  if (hasBackup) {
    consola.info(`Backed up existing ${packageName} installation`);
  }

  await warnVersionMismatch(consumerPath, packageName, entry.version);
  await configureBundler(consumerPath, packageName, pm);
  await handleMissingDeps(entry, consumerPath, pm, options.yes ?? false);

  const result = await inject(entry, consumerPath, pm);
  consola.success(
    `Linked ${packageName}@${entry.version} -> node_modules/${packageName} (${result.copied} files copied, ${result.skipped} unchanged)`
  );

  if (result.binLinks > 0) {
    consola.info(`Created ${result.binLinks} bin link(s)`);
  }

  const linkEntry: LinkEntry = {
    version: entry.version,
    contentHash: entry.meta.contentHash,
    linkedAt: new Date().toISOString(),
    sourcePath: entry.meta.sourcePath,
    backupExists: hasBackup,
    packageManager: pm,
    buildId: entry.meta.buildId ?? "",
  };
  await addLink(consumerPath, packageName, linkEntry);
  await registerConsumer(packageName, consumerPath);

  consola.info(`Done in ${timer.elapsed()}`);
  output({
    package: packageName,
    version: entry.version,
    copied: result.copied,
    skipped: result.skipped,
    binLinks: result.binLinks,
    elapsed: timer.elapsedMs(),
  });

  if (isDryRun()) printDryRunReport();
}

export async function readPackageNameFromSource(sourcePath: string): Promise<string> {
  const resolved = resolve(sourcePath);
  if (!(await exists(resolved))) {
    errorWithSuggestion(`Source path not found: ${resolved}`);
    process.exit(1);
  }

  const pkgPath = join(resolved, "package.json");
  if (!(await exists(pkgPath))) {
    errorWithSuggestion(`No package.json found at ${pkgPath}. Pass a package directory to 'knarr use'.`);
    process.exit(1);
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  } catch (err) {
    errorWithSuggestion(
      `Could not read package.json at ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  if (!pkg || typeof pkg !== "object" || typeof (pkg as { name?: unknown }).name !== "string") {
    errorWithSuggestion(`package.json at ${pkgPath} must include a package name for 'knarr use'.`);
    process.exit(1);
  }

  const name = (pkg as { name: string }).name.trim();
  validatePackageNameArg(name, name);
  return name;
}

export function parsePackageArg(arg: string): { name: string; version: string | null } {
  if (arg.startsWith("@")) {
    const slashIdx = arg.indexOf("/");
    if (slashIdx > 0) {
      const afterScope = arg.indexOf("@", slashIdx);
      if (afterScope > slashIdx) {
        return { name: arg.slice(0, afterScope), version: arg.slice(afterScope + 1) };
      }
    }
    return { name: arg, version: null };
  }

  const atIdx = arg.lastIndexOf("@");
  if (atIdx > 0) {
    return { name: arg.slice(0, atIdx), version: arg.slice(atIdx + 1) };
  }
  return { name: arg, version: null };
}

function validatePackageNameArg(packageName: string, original: string): void {
  try {
    validatePackageNameStrict(packageName);
  } catch {
    errorWithSuggestion(
      `Invalid package name "${original}". Use format: package-name or @scope/package-name.`
    );
    process.exit(1);
  }
}

async function handleMissingDeps(
  entry: NonNullable<Awaited<ReturnType<typeof findStoreEntry>>>,
  consumerPath: string,
  pm: PackageManager,
  yes: boolean,
): Promise<void> {
  const missing = await checkMissingDeps(entry, consumerPath);
  if (missing.length === 0) return;

  if (isJsonOutput()) {
    verbose(`[add] Missing transitive deps (json mode): ${missing.join(", ")}`);
    return;
  }

  if (yes) {
    const cmd = buildInstallCommand(pm, missing);
    consola.info(
      isDryRun()
        ? `[dry-run] Would install missing dependencies: ${missing.join(", ")}`
        : `Installing missing dependencies: ${missing.join(", ")}`
    );
    const ok = await runInstallCommand(cmd, consumerPath);
    if (ok && !isDryRun()) {
      consola.success("Installed missing dependencies");
    } else if (!ok) {
      consola.warn(`Install failed. Run manually: ${cmd}`);
    }
    return;
  }

  const confirm = await consola.prompt(
    `Install ${missing.length} missing dependencies? (${missing.join(", ")})`,
    { type: "confirm", initial: true },
  );
  if (confirm) {
    const cmd = buildInstallCommand(pm, missing);
    const ok = await runInstallCommand(cmd, consumerPath);
    if (ok && !isDryRun()) {
      consola.success("Installed missing dependencies");
    } else if (!ok) {
      consola.warn(`Install failed. Run manually: ${cmd}`);
    }
  } else {
    consola.warn(
      `Missing transitive dependencies: ${missing.join(", ")}\n` +
        `  Run: ${buildInstallCommand(pm, missing)}`,
    );
  }
}

async function configureBundler(
  consumerPath: string,
  packageName: string,
  pm: PackageManager,
): Promise<void> {
  const bundler = await detectBundler(consumerPath);
  if (bundler.type === "next" && bundler.configFile) {
    const configResult = await addToTranspilePackages(
      bundler.configFile,
      packageName
    );
    if (configResult.modified) {
      consola.success(
        `Added ${packageName} to transpilePackages in ${basename(bundler.configFile)}`
      );
    } else if (configResult.error) {
      consola.info(
        `Add to next.config manually: transpilePackages: ['${packageName}']`
      );
    }
  } else if (bundler.type === "vite" && bundler.configFile) {
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
      const ok = await runInstallCommand(installCmd, consumerPath);
      if (ok && !isDryRun()) {
        consola.success("Installed knarr");
      } else if (!ok) {
        consola.warn(`Install failed. Run manually: ${installCmd}`);
      }
    } else if (viteResult.error) {
      consola.info(
        `Add manually:\n  import knarr from "knarr/vite"\n  plugins: [knarr()]`
      );
    }
  }

  const { findTailwindCss, addTailwindSource } = await import("../utils/tailwind-source.js");
  const tailwindCss = await findTailwindCss(consumerPath);
  if (tailwindCss) {
    const twResult = await addTailwindSource(tailwindCss, packageName, consumerPath);
    if (twResult.modified) {
      consola.success(`Added @source for ${packageName} to ${basename(tailwindCss)}`);
    } else if (twResult.error) {
      consola.info(`Add to your CSS manually: @source "../node_modules/${packageName}";`);
    }
  }
}

function buildInstallCommand(pm: PackageManager, deps: string[]): string {
  for (const dep of deps) validatePackageNameStrict(dep);
  const joined = deps.join(" ");
  switch (pm) {
    case "pnpm":
      return `pnpm add ${joined}`;
    case "yarn":
      return `yarn add ${joined}`;
    case "bun":
      return `bun add ${joined}`;
    default:
      return `npm install ${joined}`;
  }
}

function buildDevInstallCommand(pm: PackageManager, dep: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm add -D ${dep}`;
    case "yarn":
      return `yarn add -D ${dep}`;
    case "bun":
      return `bun add -d ${dep}`;
    default:
      return `npm install -D ${dep}`;
  }
}

function runInstallCommand(cmd: string, cwd: string): Promise<boolean> {
  if (isDryRun()) {
    recordMutation({ type: "command-skip", path: cwd, detail: cmd });
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const isWin = platform() === "win32";
    const shell = isWin ? "cmd" : "sh";
    const shellFlag = isWin ? "/c" : "-c";

    const child = spawn(shell, [shellFlag, cmd], {
      cwd,
      stdio: "inherit",
    });

    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
