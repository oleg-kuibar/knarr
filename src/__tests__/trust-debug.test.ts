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
        scripts: { postinstall: "knarr restore --silent || true" },
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
        scripts: { postinstall: "knarr restore --silent || true" },
        devDependencies: { knarr: "^0.0.3" },
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
