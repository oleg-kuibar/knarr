import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exists } from "../utils/fs.js";
import { initFlags } from "../utils/logger.js";
import { resetMutations } from "../utils/dry-run.js";

const originalArgv = [...process.argv];

let knarrHome: string;
let testLib: string;
let testConsumer: string;

function setFlags(args: string[] = []): void {
  process.argv = ["node", "knarr", ...args];
  initFlags();
  resetMutations();
}

beforeEach(async () => {
  knarrHome = await mkdtemp(join(tmpdir(), "KNARR-trust-home-"));
  testLib = await mkdtemp(join(tmpdir(), "KNARR-trust-lib-"));
  testConsumer = await mkdtemp(join(tmpdir(), "KNARR-trust-consumer-"));
  process.env.KNARR_HOME = knarrHome;
  setFlags();

  await writePackage(testLib, "test-lib");
  await mkdir(join(testLib, "dist"), { recursive: true });
  await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v1";');
  await writeFile(join(testLib, "dist", "old.js"), 'module.exports = "old";');

  await writeFile(
    join(testConsumer, "package.json"),
    JSON.stringify({ name: "test-app", version: "1.0.0" }, null, 2)
  );
  await writeFile(join(testConsumer, "package-lock.json"), "{}");
  await mkdir(join(testConsumer, "node_modules"), { recursive: true });
});

afterEach(async () => {
  setFlags();
  process.argv = [...originalArgv];
  initFlags();
  resetMutations();
  delete process.env.KNARR_HOME;
  await rm(knarrHome, { recursive: true, force: true });
  await rm(testLib, { recursive: true, force: true });
  await rm(testConsumer, { recursive: true, force: true });
});

describe("doctor --fix", () => {
  it("repairs missing state, gitignore, and postinstall hook", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");

    const result = await runDoctorDiagnostics(testConsumer, { fix: true });

    expect(result.fixed).toBeGreaterThanOrEqual(3);
    expect(await exists(join(testConsumer, ".knarr", "state.json"))).toBe(true);
    expect(await readFile(join(testConsumer, ".gitignore"), "utf-8")).toContain(".knarr/");
    const pkg = JSON.parse(await readFile(join(testConsumer, "package.json"), "utf-8"));
    expect(pkg.scripts.postinstall).toContain("knarr restore");
  });

  it("reports planned repairs without writing in dry-run mode", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    const originalPkg = await readFile(join(testConsumer, "package.json"), "utf-8");
    setFlags(["--dry-run"]);

    const result = await runDoctorDiagnostics(testConsumer, { fix: true });

    expect(result.plannedFixes).toBeGreaterThanOrEqual(3);
    expect(await exists(join(testConsumer, ".knarr", "state.json"))).toBe(false);
    expect(await exists(join(testConsumer, ".gitignore"))).toBe(false);
    expect(await readFile(join(testConsumer, "package.json"), "utf-8")).toBe(originalPkg);
  });

  it("removes stale global registry entries", async () => {
    const { registerConsumer, readConsumersRegistry } = await import("../core/tracker.js");
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await registerConsumer("test-lib", join(knarrHome, "missing-consumer"));

    const result = await runDoctorDiagnostics(testConsumer, { fix: true });
    const registry = await readConsumersRegistry();

    expect(result.results.find((r) => r.name === "Stale registry entries")?.fixed).toBe(true);
    expect(registry["test-lib"]).toBeUndefined();
  });

  it("warns when postinstall restore cannot verify a knarr binary", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        scripts: { postinstall: 'knarr restore --silent || node -e "process.exit(0)"' },
      })
    );

    const result = await runDoctorDiagnostics(testConsumer);
    const postinstall = result.results.find((r) => r.name === "Postinstall restore");

    expect(postinstall?.status).toBe("warn");
    expect(postinstall?.message).toContain("no local knarr");
  });

  it("passes postinstall restore when knarr is declared locally", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        scripts: { postinstall: 'knarr restore --silent || node -e "process.exit(0)"' },
        devDependencies: { knarr: "^0.0.3" },
      })
    );

    const result = await runDoctorDiagnostics(testConsumer);
    const postinstall = result.results.find((r) => r.name === "Postinstall restore");

    expect(postinstall?.status).toBe("pass");
  });

  it("does not treat unrelated knarr postinstall commands as restore hooks", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        scripts: { postinstall: "knarr --version" },
        devDependencies: { knarr: "^0.0.3" },
      })
    );

    const result = await runDoctorDiagnostics(testConsumer);
    const postinstall = result.results.find((r) => r.name === "Postinstall restore");

    expect(postinstall?.status).toBe("warn");
    expect(postinstall?.message).toContain("does not run knarr restore");
  });

  it("passes self-resolving postinstall restore commands", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        scripts: { postinstall: "pnpm dlx knarr restore --silent" },
      })
    );

    const result = await runDoctorDiagnostics(testConsumer);
    const postinstall = result.results.find((r) => r.name === "Postinstall restore");

    expect(postinstall?.status).toBe("pass");
  });

  it("flags Yarn PnP projects as incompatible", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(join(testConsumer, "yarn.lock"), "");
    await writeFile(join(testConsumer, ".pnp.cjs"), "");

    const result = await runDoctorDiagnostics(testConsumer);
    const yarnLinker = result.results.find((r) => r.name === "Yarn linker");

    expect(yarnLinker?.status).toBe("fail");
    expect(yarnLinker?.message).toContain("PnP");
    expect(yarnLinker?.message).toContain("nodeLinker: node-modules");
    expect(yarnLinker?.message).toContain("nodeLinker: pnpm");
  });

  it("flags Yarn PnP manifests even when npm lockfiles are present", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(join(testConsumer, ".pnp.cjs"), "");

    const result = await runDoctorDiagnostics(testConsumer);
    const packageManager = result.results.find((r) => r.name === "Package manager");
    const yarnLinker = result.results.find((r) => r.name === "Yarn linker");

    expect(packageManager?.message).toBe("npm");
    expect(yarnLinker?.status).toBe("fail");
    expect(yarnLinker?.message).toContain("PnP");
  });

  it.each([
    ["explicit PnP linker", async () => {
      await writeFile(join(testConsumer, ".yarnrc.yml"), "nodeLinker: pnp\n");
    }],
    ["Yarn Berry default PnP", async () => {
      await writeFile(
        join(testConsumer, "package.json"),
        JSON.stringify({ name: "test-app", version: "1.0.0", packageManager: "yarn@4.0.0" }, null, 2)
      );
    }],
  ])("does not apply local setup fixes for %s", async (_name, prepare) => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await prepare();

    const result = await runDoctorDiagnostics(testConsumer, { fix: true });
    const state = result.results.find((r) => r.name === "Consumer state");
    const gitignore = result.results.find((r) => r.name === ".gitignore");
    const postinstall = result.results.find((r) => r.name === "Postinstall restore");

    expect(result.fixed).toBe(0);
    expect(state?.fixable).toBe(false);
    expect(gitignore?.fixable).toBe(false);
    expect(postinstall?.fixable).toBe(false);
    expect(await exists(join(testConsumer, ".knarr", "state.json"))).toBe(false);
    expect(await exists(join(testConsumer, ".gitignore"))).toBe(false);
    const pkg = JSON.parse(await readFile(join(testConsumer, "package.json"), "utf-8"));
    expect(pkg.scripts?.postinstall).toBeUndefined();
  });
});

describe("knarr explain", () => {
  it("explains a healthy linked package", async () => {
    await linkPackage();
    const { explainState } = await import("../commands/explain.js");

    const result = await explainState(testConsumer, "test-lib");
    const pkg = result.packages[0];

    expect(pkg.status).toBe("ok");
    expect(pkg.store.exists).toBe(true);
    expect(pkg.store.matchesLink).toBe(true);
    expect(pkg.nodeModules.exists).toBe(true);
    expect(pkg.consumers).toHaveLength(1);
    expect(pkg.suggestedAction).toBe("No action needed.");
  });

  it("reports missing store entries and missing node_modules packages", async () => {
    await linkPackage();
    const { removeStoreEntry } = await import("../core/store.js");
    const { explainState } = await import("../commands/explain.js");
    await removeStoreEntry("test-lib", "1.0.0");
    await rm(join(testConsumer, "node_modules", "test-lib"), {
      recursive: true,
      force: true,
    });

    const result = await explainState(testConsumer, "test-lib");
    const pkg = result.packages[0];

    expect(pkg.status).toBe("fail");
    expect(pkg.issues).toContain("store entry missing for test-lib@1.0.0");
    expect(pkg.issues).toContain("package is missing from node_modules");
  });

  it("reports stale content hashes and missing source paths", async () => {
    await linkPackage();
    const { publish } = await import("../core/publisher.js");
    const { explainState } = await import("../commands/explain.js");
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v2";');
    await publish(testLib);
    await rm(testLib, { recursive: true, force: true });

    const result = await explainState(testConsumer, "test-lib");
    const pkg = result.packages[0];

    expect(pkg.status).toBe("warn");
    expect(pkg.issues).toContain("store has newer content than the current link");
    expect(pkg.issues.some((issue) => issue.startsWith("source directory missing"))).toBe(true);
  });

  it("handles scoped package names", async () => {
    await writePackage(testLib, "@scope/test-lib");
    await linkPackage("@scope/test-lib");
    const { explainState } = await import("../commands/explain.js");

    const result = await explainState(testConsumer, "@scope/test-lib");

    expect(result.packages[0].name).toBe("@scope/test-lib");
    expect(result.packages[0].status).toBe("ok");
  });
});

describe("push summaries", () => {
  it("returns copied, removed, skipped, and per-consumer counts", async () => {
    await linkPackage();
    const { doPush } = await import("../core/push-engine.js");
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v2";');
    await rm(join(testLib, "dist", "old.js"), { force: true });

    const summary = await doPush(testLib);

    expect(summary.updatedConsumers).toBe(1);
    expect(summary.failedConsumers).toBe(0);
    expect(summary.copied).toBeGreaterThanOrEqual(1);
    expect(summary.removed).toBe(1);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.consumerResults[0].status).toBe("updated");
  });

  it("separates skipped and failed consumers", async () => {
    await linkPackage();
    const skippedConsumer = await mkdtemp(join(tmpdir(), "KNARR-trust-skip-"));
    const failedConsumer = await mkdtemp(join(tmpdir(), "KNARR-trust-fail-"));
    try {
      await writeFile(join(skippedConsumer, "package.json"), "{}");
      await writeFile(join(skippedConsumer, "package-lock.json"), "{}");

      await writeFile(join(failedConsumer, "package.json"), "{}");
      await writeFile(join(failedConsumer, "package-lock.json"), "{}");
      await writeFile(join(failedConsumer, "node_modules"), "not a directory");

      const { addLink, registerConsumer } = await import("../core/tracker.js");
      await registerConsumer("test-lib", skippedConsumer);
      await addLink(failedConsumer, "test-lib", {
        version: "1.0.0",
        contentHash: "sha256:old",
        linkedAt: new Date().toISOString(),
        sourcePath: testLib,
        backupExists: false,
        packageManager: "npm",
        buildId: "deadbeef",
      });
      await registerConsumer("test-lib", failedConsumer);

      const { doPush } = await import("../core/push-engine.js");
      await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v3";');

      const summary = await doPush(testLib);

      expect(summary.updatedConsumers).toBe(1);
      expect(summary.skippedConsumers).toBe(1);
      expect(summary.failedConsumers).toBe(1);
      expect(summary.consumerResults.map((r) => r.status).sort()).toEqual([
        "failed",
        "skipped",
        "updated",
      ]);
    } finally {
      await rm(skippedConsumer, { recursive: true, force: true });
      await rm(failedConsumer, { recursive: true, force: true });
    }
  });

  it("dry-run push does not fail when the store entry is not written", async () => {
    const { doPush } = await import("../core/push-engine.js");
    setFlags(["--dry-run"]);

    const summary = await doPush(testLib);

    expect(summary.failedConsumers).toBe(0);
    expect(summary.skippedReason).toBe("dry-run");
    expect(await exists(join(knarrHome, "store", "test-lib@1.0.0"))).toBe(false);
  });

  it("dry-run push does not preview stale store content", async () => {
    await linkPackage();
    const { doPush } = await import("../core/push-engine.js");
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v2";');
    setFlags(["--dry-run"]);

    const summary = await doPush(testLib);

    expect(summary.failedConsumers).toBe(0);
    expect(summary.skippedConsumers).toBe(1);
    expect(summary.consumerResults[0].reason).toContain("store entry was not written");
    expect(
      await readFile(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "v1";');
  });
});

describe("dry-run watch commands", () => {
  it("push --watch previews once and exits without running the build", async () => {
    const pushCommand = await import("../commands/push.js");
    await makeBuildWouldWrite(testLib);
    setFlags(["--dry-run"]);

    const originalCwd = process.cwd();
    process.chdir(testLib);
    try {
      await expectReturnsPromptly(
        pushCommand.default.run?.({
          args: watchArgs({ watch: true }),
        } as any) ?? Promise.resolve(),
        "push --watch --dry-run"
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(await exists(join(testLib, "dist", "build-ran.txt"))).toBe(false);
  });

  it("push --watch --all previews once and exits without starting workspace watchers", async () => {
    const pushCommand = await import("../commands/push.js");
    const { root, pkgDir } = await makeWorkspacePackage("dry-run-push-all");
    setFlags(["--dry-run"]);

    const originalCwd = process.cwd();
    let buildRan = false;
    process.chdir(pkgDir);
    try {
      await expectReturnsPromptly(
        pushCommand.default.run?.({
          args: watchArgs({ watch: true, all: true }),
        } as any) ?? Promise.resolve(),
        "push --watch --all --dry-run"
      );
      buildRan = await exists(join(pkgDir, "dist", "build-ran.txt"));
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }

    expect(buildRan).toBe(false);
  });

  it("dev --all previews once and exits without starting workspace watchers", async () => {
    const devCommand = await import("../commands/dev.js");
    const { root, pkgDir } = await makeWorkspacePackage("dry-run-dev-all");
    setFlags(["--dry-run"]);

    const originalCwd = process.cwd();
    let buildRan = false;
    process.chdir(pkgDir);
    try {
      await expectReturnsPromptly(
        devCommand.default.run?.({
          args: watchArgs({ all: true }),
        } as any) ?? Promise.resolve(),
        "dev --all --dry-run"
      );
      buildRan = await exists(join(pkgDir, "dist", "build-ran.txt"));
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }

    expect(buildRan).toBe(false);
  });
});

async function writePackage(dir: string, name: string): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
      },
      null,
      2
    )
  );
}

async function linkPackage(name = "test-lib"): Promise<void> {
  const { publish } = await import("../core/publisher.js");
  const { getStoreEntry } = await import("../core/store.js");
  const { inject } = await import("../core/injector.js");
  const { addLink, registerConsumer } = await import("../core/tracker.js");

  const published = await publish(testLib);
  const entry = await getStoreEntry(name, "1.0.0");
  if (!entry) throw new Error(`Expected store entry for ${name}`);
  await inject(entry, testConsumer, "npm");
  await addLink(testConsumer, name, {
    version: "1.0.0",
    contentHash: published.contentHash,
    linkedAt: new Date().toISOString(),
    sourcePath: testLib,
    backupExists: false,
    packageManager: "npm",
    buildId: published.buildId,
  });
  await registerConsumer(name, testConsumer);
}

function watchArgs(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    watch: false,
    all: false,
    "skip-build": false,
    "no-scripts": true,
    force: false,
    notify: false,
    "no-cascade": false,
    ...overrides,
  };
}

async function makeBuildWouldWrite(dir: string): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "test-lib",
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
        scripts: { build: "node build.cjs" },
      },
      null,
      2
    )
  );
  await writeFile(
    join(dir, "build.cjs"),
    "require('node:fs').writeFileSync('dist/build-ran.txt', 'ran');\n"
  );
}

async function makeWorkspacePackage(
  name: string
): Promise<{ root: string; pkgDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "KNARR-dry-run-workspace-"));
  const pkgDir = join(root, "packages", name);
  await mkdir(join(pkgDir, "dist"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, workspaces: ["packages/*"] }, null, 2)
  );
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await writeFile(join(pkgDir, "dist", "index.js"), 'module.exports = "v1";');
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
        scripts: { build: "node build.cjs" },
      },
      null,
      2
    )
  );
  await writeFile(
    join(pkgDir, "build.cjs"),
    "require('node:fs').writeFileSync('dist/build-ran.txt', 'ran');\n"
  );
  return { root, pkgDir };
}

async function expectReturnsPromptly(
  promise: Promise<unknown>,
  label: string
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not return`)), 1500);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
