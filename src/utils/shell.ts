import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

/**
 * Run a user-supplied command line through the platform shell.
 *
 * Uses Node's `shell: true`, which runs `/bin/sh -c` on POSIX and
 * `cmd.exe /d /s /c "<command>"` with verbatim arguments on Windows.
 * Spawning `cmd` with `["/c", command]` manually is wrong: Node escapes
 * embedded quotes with backslashes, which cmd.exe does not understand, so
 * commands such as `node "C:\Program Files\x\build.js"` break.
 */
export function spawnShell(
  command: string,
  options: Omit<SpawnOptions, "shell"> = {}
): ChildProcess {
  return spawn(command, { ...options, shell: true });
}

/** Quote one argument for a cmd.exe command line. */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replaceAll('"', '""')}"`;
}

/**
 * Run an executable with an argument list (no user command line).
 *
 * POSIX: spawned directly, no shell. Windows: package managers are `.cmd`
 * shims, which Node only runs through a shell, and passing an args array with
 * `shell: true` concatenates the args unescaped (and triggers DEP0190). Build
 * one properly quoted command line instead.
 */
export function spawnCommand(
  executable: string,
  args: readonly string[],
  options: Omit<SpawnOptions, "shell"> = {},
  platform: NodeJS.Platform = process.platform
): ChildProcess {
  if (platform === "win32") {
    return spawnShell([executable, ...args].map(quoteWindowsArg).join(" "), options);
  }
  return spawn(executable, args, options);
}
