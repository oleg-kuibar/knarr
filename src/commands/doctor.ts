import { defineCommand } from "citty";
import { basename, join, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import {
  cleanStaleConsumers,
  readConsumerStateSafe,
  readConsumersRegistry,
  writeConsumerState,
} from "../core/tracker.js";
import { getStoreEntry, listStoreEntries } from "../core/store.js";
import { ensureDir, exists, isNodeError } from "../utils/fs.js";
import {
  getConsumerKnarrDir,
  getConsumerStatePath,
  getConsumersPath,
  getStorePath,
} from "../utils/paths.js";
import {
  detectPackageManager,
  detectYarnNodeLinker,
  hasYarnrcYml,
  hasYarnPnpManifest,
  isYarnPnpProject,
} from "../utils/pm-detect.js";
import { detectBundler } from "../utils/bundler-detect.js";
import { addPostinstall, ensureGitignore } from "../utils/init-helpers.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import { isDryRun, isJsonOutput } from "../utils/logger.js";
import { printDryRunReport } from "../utils/dry-run.js";

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  fixable: boolean;
  fixed: boolean;
  fixes: string[];
  unfixableReason?: string;
}

export interface DoctorDiagnostics {
  results: CheckResult[];
  failures: number;
  warnings: number;
  fixed: number;
  plannedFixes: number;
  dryRun: boolean;
}

type PartialCheckResult = Omit<CheckResult, "fixable" | "fixed" | "fixes"> &
  Partial<Pick<CheckResult, "fixable" | "fixed" | "fixes">>;

export async function runDoctorDiagnostics(
  consumerPath: string,
  options: { fix?: boolean } = {}
): Promise<DoctorDiagnostics> {
  const results: CheckResult[] = [];
  const dryRun = isDryRun();
  const shouldFix = options.fix === true;
  const repairPrefix = dryRun ? "Would " : "";

  async function addCheck(
    check: PartialCheckResult,
    fix?: () => Promise<string | null>
  ): Promise<void> {
    const result: CheckResult = {
      fixable: false,
      fixed: false,
      fixes: [],
      ...check,
    };

    if (shouldFix && result.fixable && fix) {
      const fixMessage = await fix();
      if (fixMessage) {
        result.fixed = !dryRun;
        result.fixes.push(`${repairPrefix}${fixMessage}`);
      }
    }

    results.push(result);
  }

  const pm = await detectPackageManager(consumerPath);

  const storePath = getStorePath();
  if (await exists(storePath)) {
    const entries = await listStoreEntries();
    await addCheck({
      name: "Store directory",
      status: "pass",
      message: `${entries.length} entries in ${storePath}`,
    });
  } else {
    await addCheck({
      name: "Store directory",
      status: "warn",
      message: `Store not found at ${storePath}. Run 'knarr publish' to create it.`,
    });
  }

  const consumersPath = getConsumersPath();
  const registry = await readConsumersRegistry();
  if (await exists(consumersPath)) {
    const total = Object.values(registry).flat().length;
    await addCheck({
      name: "Global registry",
      status: "pass",
      message: `${Object.keys(registry).length} packages, ${total} consumer registrations`,
    });
  } else {
    await addCheck({
      name: "Global registry",
      status: "warn",
      message: "No consumers registered yet. Use 'knarr add' to link packages.",
    });
  }

  const staleRegistry = await findStaleRegistryEntries(registry);
  const staleTotal = staleRegistry.missingDirectories + staleRegistry.missingLinks;
  if (staleTotal > 0) {
    await addCheck(
      {
        name: "Stale registry entries",
        status: "warn",
        message:
          `${staleTotal} stale consumer registration(s) found` +
          (staleRegistry.unreadableConsumers > 0
            ? `; ${staleRegistry.unreadableConsumers} unreadable state file(s) skipped`
            : ""),
        fixable: true,
      },
      async () => {
        const cleaned = await cleanStaleConsumers({ removeMissingLinks: true });
        return `remove ${cleaned.removedConsumers} stale consumer registration(s)`;
      }
    );
  }

  const statePath = getConsumerStatePath(consumerPath);
  const knarrDir = getConsumerKnarrDir(consumerPath);
  const knarrDirKind = await pathKind(knarrDir);
  let stateExists = await exists(statePath);
  let { state, reliable } = await readConsumerStateSafe(consumerPath);

  if (knarrDirKind === "file") {
    await addCheck({
      name: "Consumer state",
      status: "fail",
      message: `${knarrDir} exists but is not a directory.`,
      unfixableReason: `Move or delete ${knarrDir}, then run 'knarr init'.`,
    });
    reliable = false;
  } else if (!stateExists) {
    const check: CheckResult = {
      name: "Consumer state",
      status: "warn",
      message: "No .knarr/state.json found.",
      fixable: true,
      fixed: false,
      fixes: [],
    };
    if (shouldFix) {
      await ensureDir(knarrDir);
      await writeConsumerState(consumerPath, {
        version: "1",
        packageManager: pm,
        role: "consumer",
        links: {},
      });
      check.fixed = !dryRun;
      check.fixes.push(`${repairPrefix}create .knarr/state.json`);
      stateExists = await exists(statePath);
      ({ state, reliable } = await readConsumerStateSafe(consumerPath));
    }
    results.push(check);
  } else if (!reliable) {
    await addCheck({
      name: "Consumer state",
      status: "fail",
      message:
        "state.json is corrupt or unreadable. Delete .knarr/state.json and re-run 'knarr add' for each package.",
      unfixableReason: "Corrupt state may contain links Knarr cannot safely reconstruct.",
    });
  }

  const links = reliable ? Object.entries(state.links) : [];
  if (reliable && stateExists) {
    if (links.length > 0) {
      await addCheck({
        name: "Consumer state",
        status: "pass",
        message: `${links.length} linked package(s)`,
      });
    } else {
      await addCheck({
        name: "Consumer state",
        status: "warn",
        message: "No packages linked. Use 'knarr add' to link a package.",
      });
    }
  }

  for (const [name, link] of links) {
    const entry = await getStoreEntry(name, link.version);
    if (!entry) {
      await addCheck({
        name: `Store: ${name}`,
        status: "fail",
        message: `Store entry missing for ${name}@${link.version}. Re-publish it.`,
      });
    } else if (entry.meta.contentHash !== link.contentHash) {
      await addCheck({
        name: `Store: ${name}`,
        status: "warn",
        message: `Store has newer content. Run 'knarr update' to sync.`,
      });
    } else {
      await addCheck({
        name: `Store: ${name}`,
        status: "pass",
        message: `${name}@${link.version} in sync`,
      });
    }

    const nmPath = join(consumerPath, "node_modules", name);
    if (!(await exists(nmPath))) {
      await addCheck({
        name: `node_modules: ${name}`,
        status: "fail",
        message: `Missing from node_modules. Run 'knarr restore'.`,
      });
    } else {
      try {
        const nmPkg = JSON.parse(await readFile(join(nmPath, "package.json"), "utf-8"));
        if (nmPkg.version && nmPkg.version !== link.version) {
          await addCheck({
            name: `node_modules: ${name}`,
            status: "warn",
            message: `node_modules has v${nmPkg.version} but Knarr linked v${link.version}. Run 'knarr restore'.`,
          });
        } else {
          await addCheck({
            name: `node_modules: ${name}`,
            status: "pass",
            message: "present",
          });
        }
      } catch {
        await addCheck({
          name: `node_modules: ${name}`,
          status: "pass",
          message: "present",
        });
      }
    }
  }

  await addCheck({
    name: "Package manager",
    status: "pass",
    message: pm,
  });

  if (pm === "yarn") {
    const linker = await detectYarnNodeLinker(consumerPath);
    const yarnrcExists = await hasYarnrcYml(consumerPath);
    const pnpManifestExists = await hasYarnPnpManifest(consumerPath);
    const isPnpProject = await isYarnPnpProject(consumerPath);

    if (linker === "node-modules") {
      await addCheck({
        name: "Yarn linker",
        status: "pass",
        message: "Yarn Berry with node-modules linker",
      });
    } else if (linker === "pnpm") {
      await addCheck({
        name: "Yarn linker",
        status: "pass",
        message: "Yarn pnpm linker mode (.store virtual store)",
      });
    } else if (isPnpProject) {
      const reason = linker === "pnp" || pnpManifestExists
        ? "Yarn PnP is not compatible."
        : "Yarn Berry defaults to PnP.";
      await addCheck({
        name: "Yarn linker",
        status: "fail",
        message: `${reason} Set \`nodeLinker: node-modules\` in .yarnrc.yml`,
      });
    } else if (!yarnrcExists) {
      await addCheck({
        name: "Yarn linker",
        status: "pass",
        message: "Yarn Classic, node_modules mode",
      });
    } else {
      await addCheck({
        name: "Yarn linker",
        status: "warn",
        message: "Yarn Berry defaults to PnP. Add `nodeLinker: node-modules` to .yarnrc.yml",
      });
    }
  }

  const bundler = await detectBundler(consumerPath);
  if (bundler.type) {
    await addCheck({
      name: "Bundler",
      status: "pass",
      message: `${bundler.type}${bundler.configFile ? ` (${bundler.configFile})` : ""}`,
    });
  } else {
    await addCheck({
      name: "Bundler",
      status: "warn",
      message: "No bundler config detected",
    });
  }

  if (bundler.type === "vite" && bundler.configFile) {
    const { addKnarrVitePlugin, hasKnarrVitePlugin } = await import("../utils/vite-config.js");
    const vite = await hasKnarrVitePlugin(bundler.configFile);
    if (vite.error) {
      await addCheck({
        name: "Vite integration",
        status: "warn",
        message: vite.error,
      });
    } else if (!vite.configured) {
      const check: CheckResult = {
        name: "Vite integration",
        status: "warn",
        message: "Knarr Vite plugin is missing.",
        fixable: true,
        fixed: false,
        fixes: [],
      };
      if (shouldFix) {
        const result = await addKnarrVitePlugin(bundler.configFile);
        if (result.modified) {
          check.fixed = !dryRun;
          check.fixes.push(`${repairPrefix}add Knarr Vite plugin to ${basename(bundler.configFile)}`);
        } else if (result.error) {
          check.unfixableReason = result.error;
        }
      }
      results.push(check);
    } else {
      await addCheck({
        name: "Vite integration",
        status: "pass",
        message: "Knarr plugin configured",
      });
    }
  }

  if (bundler.type === "next" && bundler.configFile) {
    const { addToTranspilePackages, hasTranspilePackage } = await import("../utils/nextjs-config.js");
    for (const [name] of links) {
      const transpile = await hasTranspilePackage(bundler.configFile, name);
      if (transpile.configured) {
        await addCheck({
          name: `Next.js integration: ${name}`,
          status: "pass",
          message: "transpilePackages configured",
        });
        continue;
      }

      const check: CheckResult = {
        name: `Next.js integration: ${name}`,
        status: "warn",
        message: `${name} is missing from transpilePackages.`,
        fixable: !transpile.error,
        fixed: false,
        fixes: [],
        ...(transpile.error ? { unfixableReason: transpile.error } : {}),
      };
      if (shouldFix && check.fixable) {
        const result = await addToTranspilePackages(bundler.configFile, name);
        if (result.modified) {
          check.fixed = !dryRun;
          check.fixes.push(`${repairPrefix}add ${name} to transpilePackages in ${basename(bundler.configFile)}`);
        } else if (result.error) {
          check.unfixableReason = result.error;
        }
      }
      results.push(check);
    }
  }

  const gitignorePath = join(consumerPath, ".gitignore");
  const gitignoreIgnored = await gitignoreIncludesKnarr(gitignorePath);
  if (gitignoreIgnored) {
    await addCheck({
      name: ".gitignore",
      status: "pass",
      message: ".knarr/ is ignored",
    });
  } else {
    await addCheck(
      {
        name: ".gitignore",
        status: "warn",
        message: ".knarr/ not in .gitignore.",
        fixable: true,
      },
      async () => {
        const changed = await ensureGitignore(gitignorePath);
        return changed ? "add .knarr/ to .gitignore" : null;
      }
    );
  }

  const pkgPath = join(consumerPath, "package.json");
  if (await exists(pkgPath)) {
    const pkg = await readJsonFile(pkgPath);
    const postinstall = pkg?.scripts?.postinstall;
    if (typeof postinstall === "string" && usesKnarrRestoreCommand(postinstall)) {
      if (await canVerifyKnarrForPostinstall(consumerPath, pkg, postinstall)) {
        await addCheck({
          name: "Postinstall restore",
          status: "pass",
          message: "postinstall runs knarr restore",
        });
      } else {
        await addCheck({
          name: "Postinstall restore",
          status: "warn",
          message: "postinstall runs knarr restore, but no local knarr dependency or binary was found.",
          unfixableReason: "Install knarr as a devDependency for reliable auto-restore, or ensure a global knarr binary is available during installs.",
        });
      }
    } else if (typeof postinstall === "string") {
      await addCheck({
        name: "Postinstall restore",
        status: "warn",
        message: "postinstall exists but does not run knarr restore.",
        unfixableReason: "Existing postinstall scripts are not merged automatically.",
      });
    } else {
      await addCheck(
        {
          name: "Postinstall restore",
          status: "warn",
          message: "postinstall restore hook is missing.",
          fixable: true,
        },
        async () => {
          const changed = await addPostinstall(pkgPath);
          return changed ? "add postinstall restore hook to package.json" : null;
        }
      );
    }
  } else {
    await addCheck({
      name: "Postinstall restore",
      status: "warn",
      message: "No package.json found.",
    });
  }

  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor >= 22) {
    await addCheck({
      name: "Node.js version",
      status: "pass",
      message: `v${process.versions.node}`,
    });
  } else {
    await addCheck({
      name: "Node.js version",
      status: "fail",
      message: `v${process.versions.node}; Knarr requires Node.js >= 22`,
    });
  }

  const failCount = results.filter((r) => r.status === "fail").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const fixedCount = results.filter((r) => r.fixed).length;
  const plannedFixCount = dryRun
    ? results.reduce((sum, r) => sum + r.fixes.length, 0)
    : 0;

  return {
    results,
    failures: failCount,
    warnings: warnCount,
    fixed: fixedCount,
    plannedFixes: plannedFixCount,
    dryRun,
  };
}

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Run diagnostic checks on your Knarr setup",
  },
  args: {
    fix: {
      type: "boolean",
      description: "Apply safe automatic repairs",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const consumerPath = resolve(".");

    consola.info(
      args.fix
        ? `Running Knarr diagnostics with safe fixes...\n`
        : "Running Knarr diagnostics...\n"
    );

    const diagnostics = await runDoctorDiagnostics(consumerPath, {
      fix: args.fix,
    });

    const icons = {
      pass: pc.green("PASS"),
      fail: pc.red("FAIL"),
      warn: pc.yellow("WARN"),
    };

    for (const r of diagnostics.results) {
      consola.log(`  ${icons[r.status]} ${r.name}: ${pc.dim(r.message)}`);
      for (const fix of r.fixes) {
        consola.log(`    ${pc.cyan(isDryRun() ? "PLAN" : "FIX")} ${pc.dim(fix)}`);
      }
      if (r.unfixableReason) {
        consola.log(`    ${pc.yellow("!")} ${pc.dim(r.unfixableReason)}`);
      }
    }

    consola.log("");
    if (diagnostics.plannedFixes > 0) {
      consola.info(`${diagnostics.plannedFixes} fix(es) would be applied`);
    } else if (diagnostics.fixed > 0) {
      consola.success(`Applied ${diagnostics.fixed} fix(es)`);
    }

    if (diagnostics.failures > 0) {
      consola.error(`${diagnostics.failures} issue(s) found that need attention`);
    } else if (diagnostics.warnings > 0) {
      consola.warn(`${diagnostics.warnings} warning(s), but no critical issues`);
    } else {
      consola.success("All checks passed!");
    }

    output(diagnostics);

    if (args.fix && isDryRun() && !isJsonOutput()) {
      printDryRunReport();
    }
  },
});

async function findStaleRegistryEntries(
  registry: Record<string, string[]>
): Promise<{
  missingDirectories: number;
  missingLinks: number;
  unreadableConsumers: number;
}> {
  let missingDirectories = 0;
  let missingLinks = 0;
  let unreadableConsumers = 0;

  for (const [pkgName, consumers] of Object.entries(registry)) {
    for (const consumerPath of consumers) {
      if (!(await exists(consumerPath))) {
        missingDirectories++;
        continue;
      }
      const { state, reliable } = await readConsumerStateSafe(consumerPath);
      if (!reliable) {
        unreadableConsumers++;
        continue;
      }
      if (!state.links[pkgName]) {
        missingLinks++;
      }
    }
  }

  return { missingDirectories, missingLinks, unreadableConsumers };
}

async function gitignoreIncludesKnarr(gitignorePath: string): Promise<boolean> {
  try {
    const content = await readFile(gitignorePath, "utf-8");
    return content.split("\n").some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === ".knarr/" ||
        trimmed === ".knarr" ||
        trimmed === "/.knarr/" ||
        trimmed === "/.knarr"
      );
    });
  } catch {
    return false;
  }
}

async function pathKind(path: string): Promise<"missing" | "file" | "dir"> {
  try {
    const s = await stat(path);
    return s.isDirectory() ? "dir" : "file";
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return "missing";
    }
    return "file";
  }
}

async function canVerifyKnarrForPostinstall(
  consumerPath: string,
  pkg: Record<string, any> | null,
  postinstall: string
): Promise<boolean> {
  if (usesSelfResolvingKnarrCommand(postinstall)) return true;
  if (declaresKnarrDependency(pkg)) return true;
  return (
    await exists(join(consumerPath, "node_modules", ".bin", "knarr")) ||
    await exists(join(consumerPath, "node_modules", ".bin", "knarr.cmd"))
  );
}

function declaresKnarrDependency(pkg: Record<string, any> | null): boolean {
  if (!pkg) return false;
  return [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
    pkg.peerDependencies,
  ].some((deps) => deps && typeof deps === "object" && "knarr" in deps);
}

function usesSelfResolvingKnarrCommand(postinstall: string): boolean {
  return /\b(?:npx(?:\s+--yes|\s+-y)?|pnpm\s+dlx|yarn\s+dlx|bunx)\s+knarr\s+restore(?:\s|$)/.test(postinstall);
}

function usesKnarrRestoreCommand(postinstall: string): boolean {
  return /(?:^|[;&|()\s])(?:(?:npx(?:\s+(?:--yes|-y))?|pnpm\s+dlx|yarn\s+dlx|bunx)\s+)?knarr\s+restore(?:\s|$)/.test(postinstall);
}

async function readJsonFile(path: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}
