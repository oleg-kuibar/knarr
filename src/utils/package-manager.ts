import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { PackageManager } from "../types.js";
import { recordMutation } from "./dry-run.js";
import { isDryRun } from "./logger.js";
import {
  detectPackageManagerInfo,
  detectYarnNodeLinker,
  detectYarnPnpmStoreFolder,
  hasYarnPnpManifest,
  hasYarnrcYml,
  isYarnPnpProject,
} from "./pm-detect.js";
import type { YarnNodeLinker } from "./pm-detect.js";
import { validatePackageName as validatePackageNameStrict } from "./validators.js";

export type PackageInstallLayout =
  | "node-modules"
  | "pnpm"
  | "yarn-pnpm"
  | "bun";

export interface PackageManagerCommand {
  executable: PackageManager;
  args: string[];
}

interface ResolvedPackageManagerBase {
  packageManager: PackageManager;
  layout: PackageInstallLayout;
  virtualStoreFolder: string | null;
  yarnLinkerDiagnostic: {
    status: "pass" | "warn" | "fail";
    message: string;
  } | null;
  installCommand(
    dependencies: string[],
    options?: { dev?: boolean }
  ): PackageManagerCommand;
  formatCommand(command: PackageManagerCommand): string;
  run(command: PackageManagerCommand): Promise<boolean>;
}

export type ResolvedPackageManager = ResolvedPackageManagerBase & (
  | { nodeModulesCompatible: true; incompatibilityReason: null }
  | { nodeModulesCompatible: false; incompatibilityReason: string }
);

export interface ProjectPackageManager {
  resolve(trackedPackageManager?: PackageManager): ResolvedPackageManager;
}

interface PackageManagerAdapter {
  layout(nodeLinker: YarnNodeLinker | null): PackageInstallLayout;
  installArgs(dependencies: string[], dev: boolean): string[];
}

const PACKAGE_MANAGER_ADAPTERS: Record<PackageManager, PackageManagerAdapter> = {
  npm: {
    layout: () => "node-modules",
    installArgs: (dependencies, dev) => [
      "install",
      ...(dev ? ["-D"] : []),
      ...dependencies,
    ],
  },
  pnpm: {
    layout: () => "pnpm",
    installArgs: (dependencies, dev) => [
      "add",
      ...(dev ? ["-D"] : []),
      ...dependencies,
    ],
  },
  yarn: {
    layout: (nodeLinker) =>
      nodeLinker === "pnpm" ? "yarn-pnpm" : "node-modules",
    installArgs: (dependencies, dev) => [
      "add",
      ...(dev ? ["-D"] : []),
      ...dependencies,
    ],
  },
  bun: {
    layout: () => "bun",
    installArgs: (dependencies, dev) => [
      "add",
      ...(dev ? ["-d"] : []),
      ...dependencies,
    ],
  },
};

const YARN_PNP_INCOMPATIBILITY =
  "Yarn PnP mode is not compatible with Knarr.\n\n" +
  "Knarr works by copying files into node_modules/, but PnP eliminates\n" +
  "node_modules/ entirely. To use Knarr with Yarn Berry, add one of these\n" +
  "to .yarnrc.yml:\n\n" +
  "  nodeLinker: node-modules\n" +
  "  nodeLinker: pnpm\n\n" +
  "Then run: yarn install";

export async function inspectProjectPackageManager(
  projectDir: string,
  options: { packageManager?: PackageManager } = {}
): Promise<ProjectPackageManager> {
  const [
    detection,
    configExists,
    pnpManifestExists,
    nodeLinker,
    pnpmStoreFolder,
    yarnPnpByPolicy,
  ] = await Promise.all([
    detectPackageManagerInfo(projectDir),
    hasYarnrcYml(projectDir),
    hasYarnPnpManifest(projectDir),
    detectYarnNodeLinker(projectDir),
    detectYarnPnpmStoreFolder(projectDir),
    isYarnPnpProject(projectDir),
  ]);

  const resolvePackageManager = (
    trackedPackageManager?: PackageManager
  ): ResolvedPackageManager => {
    const packageManager = options.packageManager ??
      (detection.source === "default" && trackedPackageManager
        ? trackedPackageManager
        : detection.packageManager);
    const adapter = PACKAGE_MANAGER_ADAPTERS[packageManager];
    const isPnp =
      pnpManifestExists ||
      nodeLinker === "pnp" ||
      (packageManager === "yarn" && yarnPnpByPolicy);
    const layout = adapter.layout(nodeLinker);

    const base: ResolvedPackageManagerBase = {
      packageManager,
      layout,
      virtualStoreFolder: layout === "yarn-pnpm" ? pnpmStoreFolder : null,
      yarnLinkerDiagnostic: getYarnLinkerDiagnostic({
        packageManager,
        configExists,
        pnpManifestExists,
        nodeLinker,
        isPnp,
      }),
      installCommand(dependencies, commandOptions = {}) {
        return createInstallCommand(
          packageManager,
          dependencies,
          commandOptions.dev === true
        );
      },
      formatCommand,
      run(command) {
        return runPackageManagerCommand(command, projectDir);
      },
    };
    return isPnp
      ? {
        ...base,
        nodeModulesCompatible: false,
        incompatibilityReason: YARN_PNP_INCOMPATIBILITY,
      }
      : {
        ...base,
        nodeModulesCompatible: true,
        incompatibilityReason: null,
      };
  };

  return {
    resolve: resolvePackageManager,
  };
}

function getYarnLinkerDiagnostic(options: {
  packageManager: PackageManager;
  configExists: boolean;
  pnpManifestExists: boolean;
  nodeLinker: YarnNodeLinker | null;
  isPnp: boolean;
}): ResolvedPackageManagerBase["yarnLinkerDiagnostic"] {
  const {
    packageManager,
    configExists,
    pnpManifestExists,
    nodeLinker,
    isPnp,
  } = options;
  if (packageManager !== "yarn" && !configExists && !pnpManifestExists) {
    return null;
  }
  if (nodeLinker === "node-modules") {
    return {
      status: "pass",
      message: "Yarn Berry with node-modules linker",
    };
  }
  if (nodeLinker === "pnpm") {
    return {
      status: "pass",
      message: "Yarn pnpm linker mode (.store virtual store)",
    };
  }
  if (isPnp) {
    const reason = nodeLinker === "pnp" || pnpManifestExists
      ? "Yarn PnP is not compatible."
      : "Yarn Berry defaults to PnP.";
    return {
      status: "fail",
      message: `${reason} Set \`nodeLinker: node-modules\` or \`nodeLinker: pnpm\` in .yarnrc.yml`,
    };
  }
  if (!configExists) {
    return {
      status: "pass",
      message: "Yarn Classic, node_modules mode",
    };
  }
  return {
    status: "warn",
    message: "Yarn Berry defaults to PnP. Add `nodeLinker: node-modules` or `nodeLinker: pnpm` to .yarnrc.yml",
  };
}

function createInstallCommand(
  packageManager: PackageManager,
  dependencies: string[],
  dev: boolean
): PackageManagerCommand {
  if (dependencies.length === 0) {
    throw new Error("No dependencies provided");
  }
  for (const dependency of dependencies) {
    validatePackageNameStrict(dependency);
  }
  return {
    executable: packageManager,
    args: PACKAGE_MANAGER_ADAPTERS[packageManager].installArgs(dependencies, dev),
  };
}

export function formatCommand(command: PackageManagerCommand): string {
  return [command.executable, ...command.args].join(" ");
}

export function runPackageManagerCommand(
  command: PackageManagerCommand,
  cwd: string
): Promise<boolean> {
  const display = formatCommand(command);
  if (isDryRun()) {
    recordMutation({ type: "command-skip", path: cwd, detail: display });
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      stdio: "inherit",
      shell: platform() === "win32",
    });

    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
