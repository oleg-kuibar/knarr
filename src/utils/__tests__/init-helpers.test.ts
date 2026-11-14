import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureGitignore,
  addPostinstall,
  removePostinstall,
  POSTINSTALL_RESTORE_COMMAND,
  LEGACY_POSTINSTALL_RESTORE_COMMAND,
  RESTORE_SCRIPT_NAME,
  renderRestoreScript,
  usesKnarrRestoreCommand,
  usesSelfResolvingKnarrCommand,
} from "../init-helpers.js";
import { exists } from "../fs.js";
import { spawnShell } from "../shell.js";
import { initFlags } from "../logger.js";
import { resetMutations } from "../dry-run.js";

const originalArgv = [...process.argv];

function setDryRun(enabled: boolean): void {
  process.argv = enabled ? ["node", "knarr", "--dry-run"] : ["node", "knarr"];
  initFlags();
  resetMutations();
}

describe("init helpers dry-run", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-init-"));
    setDryRun(true);
  });

  afterEach(async () => {
    setDryRun(false);
    process.argv = [...originalArgv];
    initFlags();
    resetMutations();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not create .gitignore during dry-run", async () => {
    const gitignorePath = join(tempDir, ".gitignore");

    const changed = await ensureGitignore(gitignorePath);

    expect(changed).toBe(true);
    expect(await exists(gitignorePath)).toBe(false);
  });

  it("does not modify package.json during dry-run", async () => {
    const pkgPath = join(tempDir, "package.json");
    const original = JSON.stringify({ name: "app", version: "1.0.0" }, null, 2);
    await writeFile(pkgPath, original);

    const changed = await addPostinstall(pkgPath);

    expect(changed).toBe(true);
    expect(await readFile(pkgPath, "utf-8")).toBe(original);
  });
});

describe("addPostinstall", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-init-"));
    setDryRun(false);
  });

  afterEach(async () => {
    setDryRun(false);
    process.argv = [...originalArgv];
    initFlags();
    resetMutations();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("adds a package-manager-neutral restore hook", async () => {
    const pkgPath = join(tempDir, "package.json");
    await writeFile(pkgPath, JSON.stringify({ name: "app", version: "1.0.0" }, null, 2));

    const changed = await addPostinstall(pkgPath);

    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(changed).toBe(true);
    expect(pkg.scripts.postinstall).toBe(POSTINSTALL_RESTORE_COMMAND);
    expect(pkg.scripts.postinstall).not.toContain("npx");
    expect(pkg.scripts.postinstall).not.toContain("|| true");
    expect(pkg.scripts.postinstall).toContain("node -e");
  });

  it("does not overwrite an existing postinstall hook", async () => {
    const pkgPath = join(tempDir, "package.json");
    await writeFile(
      pkgPath,
      JSON.stringify(
        { name: "app", version: "1.0.0", scripts: { postinstall: "echo done" } },
        null,
        2
      )
    );

    const changed = await addPostinstall(pkgPath);

    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(changed).toBe(false);
    expect(pkg.scripts.postinstall).toBe("echo done");
  });

  it("does not treat unrelated knarr postinstall commands as restore hooks", async () => {
    const pkgPath = join(tempDir, "package.json");
    await writeFile(
      pkgPath,
      JSON.stringify(
        { name: "app", version: "1.0.0", scripts: { postinstall: "knarr --version" } },
        null,
        2
      )
    );

    const changed = await addPostinstall(pkgPath);
    const removed = await removePostinstall(pkgPath);

    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(changed).toBe(false);
    expect(removed).toBe(false);
    expect(pkg.scripts.postinstall).toBe("knarr --version");
  });

  it.each([
    "knarr restore --silent",
    "npx --yes knarr restore --silent",
    "pnpm dlx knarr restore --silent",
    "yarn dlx knarr restore --silent",
    "bunx knarr restore --silent",
  ])("detects restore hook command: %s", (command) => {
    expect(usesKnarrRestoreCommand(command)).toBe(true);
  });

  it.each([
    "npx --yes knarr restore --silent",
    "pnpm dlx knarr restore --silent",
    "yarn dlx knarr restore --silent",
    "bunx knarr restore --silent",
  ])("detects self-resolving restore command: %s", (command) => {
    expect(usesSelfResolvingKnarrCommand(command)).toBe(true);
  });

  it("removes restore hooks but not other scripts", async () => {
    const pkgPath = join(tempDir, "package.json");
    await writeFile(
      pkgPath,
      JSON.stringify(
        {
          name: "app",
          version: "1.0.0",
          scripts: { postinstall: "pnpm dlx knarr restore --silent" },
        },
        null,
        2
      )
    );

    const removed = await removePostinstall(pkgPath);

    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(removed).toBe(true);
    expect(pkg.scripts).toBeUndefined();
  });

  it("preserves composite postinstall scripts that include knarr restore", async () => {
    const pkgPath = join(tempDir, "package.json");
    await writeFile(
      pkgPath,
      JSON.stringify(
        {
          name: "app",
          version: "1.0.0",
          scripts: { postinstall: `echo setup && ${POSTINSTALL_RESTORE_COMMAND}` },
        },
        null,
        2
      )
    );

    const removed = await removePostinstall(pkgPath);

    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(removed).toBe(false);
    expect(pkg.scripts.postinstall).toBe(`echo setup && ${POSTINSTALL_RESTORE_COMMAND}`);
  });
});

describe("postinstall restore hook", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-hook-"));
    setDryRun(false);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    initFlags();
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Run the committed hook the way npm does: through the platform shell, cwd = project root. */
  function runHook(env: NodeJS.ProcessEnv = process.env): Promise<{ code: number | null; out: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawnShell(POSTINSTALL_RESTORE_COMMAND, { cwd: tempDir, env });
      let out = "";
      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (out += d));
      child.on("close", (code) => resolvePromise({ code, out }));
      child.on("error", reject);
    });
  }

  it("upgrades Knarr's legacy hook in place, including inside a compound script", async () => {
    const pkgPath = join(tempDir, "package.json");
    await writeFile(
      pkgPath,
      JSON.stringify({ name: "app", scripts: { postinstall: `echo setup && ${LEGACY_POSTINSTALL_RESTORE_COMMAND}` } })
    );

    expect(await addPostinstall(pkgPath)).toBe(true);
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    expect(pkg.scripts.postinstall).toBe(`echo setup && ${POSTINSTALL_RESTORE_COMMAND}`);
    expect(usesKnarrRestoreCommand(pkg.scripts.postinstall)).toBe(true);
    expect(await addPostinstall(pkgPath)).toBe(false);
  });

  it("is a silent no-op for teammates without .knarr/", async () => {
    const { code, out } = await runHook();
    expect(code).toBe(0);
    expect(out.trim()).toBe("");
  });

  it("runs the recorded Knarr CLI with restore --silent", async () => {
    const fakeCli = join(tempDir, "fake-cli.mjs");
    await writeFile(
      fakeCli,
      'import { writeFileSync } from "node:fs";\nwriteFileSync("ran.txt", process.argv.slice(2).join(" "));\n'
    );
    await mkdir(join(tempDir, ".knarr"));
    await writeFile(join(tempDir, ".knarr", RESTORE_SCRIPT_NAME), renderRestoreScript(fakeCli));

    const { code } = await runHook();

    expect(code).toBe(0);
    expect(await readFile(join(tempDir, "ran.txt"), "utf-8")).toBe("restore --silent");
  });

  it("warns instead of failing the install when no Knarr CLI can be found", async () => {
    await mkdir(join(tempDir, ".knarr"));
    await writeFile(
      join(tempDir, ".knarr", RESTORE_SCRIPT_NAME),
      renderRestoreScript(join(tempDir, "gone", "cli.mjs"))
    );
    // PATH with only node's directory: no global knarr.
    const env = { ...process.env, PATH: dirname(process.execPath), Path: dirname(process.execPath) };

    const { code, out } = await runHook(env);

    expect(code).toBe(0);
    expect(out).toContain("NOT restored");
  });
});
