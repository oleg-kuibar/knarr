import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { PackageManager } from "../types.js";
import { recordMutation } from "./dry-run.js";
import { isDryRun } from "./logger.js";
import { validatePackageName as validatePackageNameStrict } from "./validators.js";

export function buildInstallCommand(pm: PackageManager, deps: string[]): string {
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

export function buildDevInstallCommand(pm: PackageManager, dep: string): string {
  validatePackageNameStrict(dep);
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

export function runShellCommand(cmd: string, cwd: string): Promise<boolean> {
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
