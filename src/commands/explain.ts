import { defineCommand } from "citty";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { getStoreEntry, findStoreEntry } from "../core/store.js";
import { resolveInjectionTarget } from "../core/injector.js";
import { readConsumerStateSafe, readConsumersRegistry } from "../core/tracker.js";
import { detectPackageManager } from "../utils/pm-detect.js";
import { exists } from "../utils/fs.js";
import {
  getConsumerBackupPath,
  getNodeModulesPackagePath,
  normalizePath,
} from "../utils/paths.js";
import { suppressHumanOutput, output } from "../utils/output.js";
import type { LinkEntry, PackageManager } from "../types.js";

export interface ConsumerRegistrationExplanation {
  path: string;
  exists: boolean;
  stateReliable: boolean | null;
  hasLink: boolean | null;
}

export interface PackageExplanation {
  name: string;
  status: "ok" | "warn" | "fail";
  summary: string;
  suggestedAction: string;
  linked: boolean;
  version: string | null;
  buildId: string | null;
  sourcePath: string | null;
  sourceExists: boolean | null;
  packageManager: PackageManager;
  store: {
    exists: boolean;
    path: string | null;
    contentHash: string | null;
    matchesLink: boolean | null;
    publishedAt: string | null;
  };
  nodeModules: {
    path: string;
    targetPath: string;
    exists: boolean;
    packageVersion: string | null;
  };
  backup: {
    expected: boolean;
    exists: boolean;
    path: string | null;
  };
  consumers: ConsumerRegistrationExplanation[];
  issues: string[];
}

export interface ExplainResult {
  consumerPath: string;
  stateReliable: boolean;
  packages: PackageExplanation[];
}

export async function explainState(
  consumerPath: string,
  packageName?: string
): Promise<ExplainResult> {
  const { state, reliable } = await readConsumerStateSafe(consumerPath);
  const pm = await detectPackageManager(consumerPath);

  if (!reliable) {
    return {
      consumerPath,
      stateReliable: false,
      packages: packageName
        ? [await explainPackage(consumerPath, packageName, null, pm, false)]
        : [],
    };
  }

  const entries = packageName
    ? [[packageName, state.links[packageName] ?? null] as const]
    : Object.entries(state.links);

  const packages = await Promise.all(
    entries.map(([name, link]) => explainPackage(consumerPath, name, link, pm, true))
  );

  return {
    consumerPath,
    stateReliable: true,
    packages,
  };
}

export default defineCommand({
  meta: {
    name: "explain",
    description: "Explain linked package state and suggested recovery actions",
  },
  args: {
    package: {
      type: "positional",
      description: "Package name to explain (default: all linked packages)",
      required: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const consumerPath = resolve(".");
    const result = await explainState(consumerPath, args.package);

    if (!result.stateReliable) {
      consola.error("Consumer state is corrupt or unreadable");
      consola.info("Delete .knarr/state.json and re-run 'knarr add' for each package.");
    } else if (result.packages.length === 0) {
      consola.info("No linked packages in this project");
    } else if (args.package) {
      renderDetailed(result.packages[0]);
    } else {
      consola.info(`Linked packages (${result.packages.length}):\n`);
      for (const pkg of result.packages) {
        const icon = pkg.status === "ok" ? pc.green("OK") : pkg.status === "warn" ? pc.yellow("!") : pc.red("FAIL");
        const version = pkg.version ? pc.dim(`@${pkg.version}`) : pc.dim("(not linked)");
        const build = pkg.buildId ? pc.dim(` [${pkg.buildId}]`) : "";
        consola.log(`  ${icon} ${pc.cyan(pkg.name)} ${version}${build}`);
        consola.log(`    ${pc.dim(pkg.summary)}`);
      }
      consola.log("");
      consola.info(`Run ${pc.cyan("knarr explain <package>")} for details.`);
    }

    output(result);
  },
});

async function explainPackage(
  consumerPath: string,
  name: string,
  link: LinkEntry | null,
  pm: PackageManager,
  stateReliable: boolean
): Promise<PackageExplanation> {
  const latestEntry = link
    ? await getStoreEntry(name, link.version)
    : await findStoreEntry(name);
  const registry = await readConsumersRegistry();
  const registeredConsumers = registry[name] ?? [];
  const normalizedConsumerPath = normalizePath(consumerPath);
  const issues: string[] = [];

  if (!stateReliable) {
    issues.push("consumer state is corrupt or unreadable");
  }
  if (!link) {
    issues.push("package is not linked in this project");
  }

  const sourcePath = link?.sourcePath ?? latestEntry?.meta.sourcePath ?? null;
  const sourceExists = sourcePath ? await exists(sourcePath) : null;
  if (sourcePath && sourceExists === false) {
    issues.push(`source directory missing: ${sourcePath}`);
  }

  if (!latestEntry) {
    issues.push(link ? `store entry missing for ${name}@${link.version}` : "package not found in store");
  } else if (link && latestEntry.meta.contentHash !== link.contentHash) {
    issues.push("store has newer content than the current link");
  }

  const nodeModulesPath = getNodeModulesPackagePath(consumerPath, name);
  const targetPath = link
    ? await resolveInjectionTarget(consumerPath, name, link.packageManager, link.version, {
        warnOnFallback: false,
      })
    : nodeModulesPath;
  const nodeModulesExists = await exists(targetPath);
  const nodeModulesVersion = nodeModulesExists
    ? await readPackageVersion(targetPath)
    : null;
  if (link && !nodeModulesExists) {
    issues.push("package is missing from node_modules");
  } else if (link && nodeModulesVersion && nodeModulesVersion !== link.version) {
    issues.push(`node_modules has v${nodeModulesVersion} but link expects v${link.version}`);
  }

  const backupPath = link ? getConsumerBackupPath(consumerPath, name) : null;
  const backupExists = backupPath ? await exists(backupPath) : false;
  if (link?.backupExists && !backupExists) {
    issues.push("backup is recorded but missing on disk");
  }

  const consumers = await Promise.all(
    registeredConsumers.map(async (path) => {
      const consumerExists = await exists(path);
      if (!consumerExists) {
        return {
          path,
          exists: false,
          stateReliable: null,
          hasLink: null,
        };
      }
      const { state, reliable } = await readConsumerStateSafe(path);
      return {
        path,
        exists: true,
        stateReliable: reliable,
        hasLink: reliable ? !!state.links[name] : null,
      };
    })
  );

  if (link && !registeredConsumers.includes(normalizedConsumerPath)) {
    issues.push("current project is not registered for pushes");
  }

  const status: PackageExplanation["status"] = issues.some((i) =>
    i.includes("corrupt") ||
    i.includes("missing from node_modules") ||
    i.includes("store entry missing") ||
    i.includes("not linked")
  )
    ? "fail"
    : issues.length > 0
      ? "warn"
      : "ok";

  return {
    name,
    status,
    summary: summarize(name, link, issues),
    suggestedAction: suggestAction(name, link, issues, sourcePath),
    linked: !!link,
    version: link?.version ?? latestEntry?.version ?? null,
    buildId: link?.buildId || latestEntry?.meta.buildId || null,
    sourcePath,
    sourceExists,
    packageManager: link?.packageManager ?? pm,
    store: {
      exists: !!latestEntry,
      path: latestEntry?.packageDir ?? null,
      contentHash: latestEntry?.meta.contentHash ?? null,
      matchesLink: link && latestEntry ? latestEntry.meta.contentHash === link.contentHash : null,
      publishedAt: latestEntry?.meta.publishedAt ?? null,
    },
    nodeModules: {
      path: nodeModulesPath,
      targetPath,
      exists: nodeModulesExists,
      packageVersion: nodeModulesVersion,
    },
    backup: {
      expected: link?.backupExists ?? false,
      exists: backupExists,
      path: backupPath,
    },
    consumers,
    issues,
  };
}

function renderDetailed(pkg: PackageExplanation): void {
  const icon = pkg.status === "ok" ? pc.green("OK") : pkg.status === "warn" ? pc.yellow("WARN") : pc.red("FAIL");
  consola.info(`${icon} ${pc.cyan(pkg.name)} ${pc.dim(pkg.summary)}\n`);

  consola.log(`  Version: ${pkg.version ?? "(not linked)"}`);
  consola.log(`  Build ID: ${pkg.buildId ?? "(none)"}`);
  consola.log(`  Package manager: ${pkg.packageManager}`);
  consola.log(`  Source: ${pkg.sourcePath ?? "(unknown)"}${pkg.sourceExists === false ? " (missing)" : ""}`);
  consola.log(`  Store: ${pkg.store.exists ? pkg.store.path : "(missing)"}`);
  if (pkg.store.matchesLink !== null) {
    consola.log(`  Content hash: ${pkg.store.matchesLink ? "matches link" : "differs from link"}`);
  }
  consola.log(`  node_modules: ${pkg.nodeModules.targetPath}${pkg.nodeModules.exists ? "" : " (missing)"}`);
  consola.log(`  Backup: ${pkg.backup.expected ? (pkg.backup.exists ? "present" : "missing") : "not recorded"}`);
  consola.log(`  Registered consumers: ${pkg.consumers.length}`);

  if (pkg.issues.length > 0) {
    consola.log("");
    for (const issue of pkg.issues) {
      consola.log(`  ${pc.yellow("!")} ${issue}`);
    }
  }

  consola.log("");
  consola.info(`Suggested action: ${pkg.suggestedAction}`);
}

function summarize(name: string, link: LinkEntry | null, issues: string[]): string {
  if (!link) return `${name} is not linked in this project`;
  if (issues.length === 0) return "link, store, and node_modules are in sync";
  return issues[0];
}

function suggestAction(
  name: string,
  link: LinkEntry | null,
  issues: string[],
  sourcePath: string | null
): string {
  if (issues.some((i) => i.includes("corrupt"))) {
    return "Delete .knarr/state.json and re-run 'knarr add' for each package.";
  }
  if (!link) {
    return `Run 'knarr add ${name}' or 'knarr use <path>'.`;
  }
  if (issues.some((i) => i.includes("store entry missing"))) {
    return sourcePath
      ? `Run 'knarr publish' in ${sourcePath}, then 'knarr restore'.`
      : "Re-publish the package, then run 'knarr restore'.";
  }
  if (issues.some((i) => i.includes("newer content"))) {
    return `Run 'knarr update ${name}'.`;
  }
  if (issues.some((i) => i.includes("node_modules"))) {
    return "Run 'knarr restore'.";
  }
  if (issues.some((i) => i.includes("not registered"))) {
    return `Run 'knarr add ${name}' again to refresh registration.`;
  }
  if (issues.some((i) => i.includes("source directory"))) {
    return `Check the source path or re-run 'knarr use <path>'.`;
  }
  return "No action needed.";
}

async function readPackageVersion(packageDir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(packageDir, "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
