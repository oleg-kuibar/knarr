import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureGitignore,
  addPostinstall,
  removePostinstall,
  POSTINSTALL_RESTORE_COMMAND,
  usesKnarrRestoreCommand,
  usesSelfResolvingKnarrCommand,
} from "../init-helpers.js";
import { exists } from "../fs.js";
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
