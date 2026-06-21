import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { PackageManager } from "../types.js";
import { recordMutation } from "./dry-run.js";
import { isDryRun } from "./logger.js";
import { validatePackageName as validatePackageNameStrict } from "./validators.js";

export interface PackageManagerCommand {
  executable: PackageManager;
  args: string[];
}

export function formatPackageManagerCommand(cmd: PackageManagerCommand): string {
  return [cmd.executable, ...cmd.args].join(" ");
}

export function buildInstallCommand(pm: PackageManager, deps: string[]): PackageManagerCommand {
  if (deps.length === 0) {
    throw new Error("No dependencies provided");
  }
  for (const dep of deps) validatePackageNameStrict(dep);
  switch (pm) {
    case "pnpm":
      return { executable: "pnpm", args: ["add", ...deps] };
    case "yarn":
      return { executable: "yarn", args: ["add", ...deps] };
    case "bun":
      return { executable: "bun", args: ["add", ...deps] };
    default:
      return { executable: "npm", args: ["install", ...deps] };
  }
}

export function buildDevInstallCommand(pm: PackageManager, dep: string): PackageManagerCommand {
  validatePackageNameStrict(dep);
  switch (pm) {
    case "pnpm":
      return { executable: "pnpm", args: ["add", "-D", dep] };
    case "yarn":
      return { executable: "yarn", args: ["add", "-D", dep] };
    case "bun":
      return { executable: "bun", args: ["add", "-d", dep] };
    default:
      return { executable: "npm", args: ["install", "-D", dep] };
  }
}

export function runPackageManagerCommand(
  cmd: PackageManagerCommand,
  cwd: string
): Promise<boolean> {
  const display = formatPackageManagerCommand(cmd);
  if (isDryRun()) {
    recordMutation({ type: "command-skip", path: cwd, detail: display });
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const isWin = platform() === "win32";

    const child = spawn(cmd.executable, cmd.args, {
      cwd,
      stdio: "inherit",
      shell: isWin,
    });

    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
