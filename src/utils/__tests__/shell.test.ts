import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { quoteWindowsArg, spawnCommand, spawnShell } from "../shell.js";

function run(command: string, cwd: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawnShell(command, { cwd, stdio: "ignore" });
    child.on("close", resolve);
    child.on("error", reject);
  });
}

describe("spawnShell", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "KNARR-shell-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs commands with quoted paths that contain spaces", async () => {
    const scriptDir = join(dir, "dir with spaces");
    await mkdir(scriptDir);
    const script = join(scriptDir, "write.mjs");
    await writeFile(
      script,
      'import { writeFileSync } from "node:fs";\nwriteFileSync("out.txt", process.argv.slice(2).join("|"));\n'
    );

    // process.execPath itself contains a space on default Windows installs.
    const code = await run(`"${process.execPath}" "${script}" "a b" c`, dir);

    expect(code).toBe(0);
    expect(await readFile(join(dir, "out.txt"), "utf-8")).toBe("a b|c");
  });

  it("propagates non-zero exit codes", async () => {
    const code = await run(`"${process.execPath}" -e "process.exit(3)"`, dir);
    expect(code).toBe(3);
  });
});

describe("spawnCommand", () => {
  it("quotes cmd.exe arguments with spaces, quotes, and metacharacters", () => {
    expect(quoteWindowsArg("plain-arg")).toBe("plain-arg");
    expect(quoteWindowsArg(String.raw`C:\Program Files\x`)).toBe(String.raw`"C:\Program Files\x"`);
    expect(quoteWindowsArg('say "hi"')).toBe('"say ""hi"""');
    expect(quoteWindowsArg("a&b")).toBe('"a&b"');
    expect(quoteWindowsArg("")).toBe('""');
  });

  it("passes arguments with spaces through intact without a deprecation warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "KNARR-spawncmd-"));
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.name + ": " + w.message);
    process.on("warning", onWarning);
    try {
      const code = await new Promise<number | null>((resolvePromise, reject) => {
        const child = spawnCommand(
          process.execPath,
          ["-e", 'require("fs").writeFileSync("out.txt", process.argv.slice(1).join("|"))', "a b", "c"],
          { cwd: dir, stdio: "ignore" }
        );
        child.on("close", resolvePromise);
        child.on("error", reject);
      });
      expect(code).toBe(0);
      expect(await readFile(join(dir, "out.txt"), "utf-8")).toBe("a b|c");
      expect(warnings.filter((w) => w.includes("DEP0190") || w.includes("shell option"))).toEqual([]);
    } finally {
      process.off("warning", onWarning);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
