import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore, addPostinstall } from "../init-helpers.js";
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
