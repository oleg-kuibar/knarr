import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  lstat,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { exists } from "../utils/fs.js";
import { detectYarnNodeLinker } from "../utils/pm-detect.js";
import { initFlags } from "../utils/logger.js";
import { consola } from "../utils/console.js";

let testKNARRHome: string;
let testLib: string;
let testConsumer: string;

beforeEach(async () => {
  testKNARRHome = await mkdtemp(join(tmpdir(), "KNARR-home-"));
  testLib = await mkdtemp(join(tmpdir(), "KNARR-lib-"));
  testConsumer = await mkdtemp(join(tmpdir(), "KNARR-consumer-"));

  // Point Knarr store to temp dir
  process.env.KNARR_HOME = testKNARRHome;

  // Create a test library
  await writeFile(
    join(testLib, "package.json"),
    JSON.stringify({
      name: "test-lib",
      version: "1.0.0",
      main: "dist/index.js",
      files: ["dist"],
    })
  );
  await mkdir(join(testLib, "dist"), { recursive: true });
  await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "hello";');

  // Create a test consumer
  await writeFile(
    join(testConsumer, "package.json"),
    JSON.stringify({ name: "test-app", version: "1.0.0" })
  );
  await writeFile(join(testConsumer, "package-lock.json"), "{}");
  await mkdir(join(testConsumer, "node_modules"), { recursive: true });
});

afterEach(async () => {
  delete process.env.KNARR_HOME;
  await rm(testKNARRHome, { recursive: true, force: true });
  await rm(testLib, { recursive: true, force: true });
  await rm(testConsumer, { recursive: true, force: true });
});

describe("publish", () => {
  it("publishes a package to the store", async () => {
    const { publish } = await import("../core/publisher.js");
    const result = await publish(testLib);

    expect(result.name).toBe("test-lib");
    expect(result.version).toBe("1.0.0");
    expect(result.skipped).toBe(false);
    expect(result.fileCount).toBeGreaterThan(0);

    // Verify store structure
    const storePkg = join(
      testKNARRHome,
      "store",
      "test-lib@1.0.0",
      "package"
    );
    expect(await exists(storePkg)).toBe(true);
    expect(await exists(join(storePkg, "package.json"))).toBe(true);
    expect(await exists(join(storePkg, "dist", "index.js"))).toBe(true);

    // Verify meta
    const meta = JSON.parse(
      await readFile(
        join(testKNARRHome, "store", "test-lib@1.0.0", ".knarr-meta.json"),
        "utf-8"
      )
    );
    expect(meta.contentHash).toMatch(/^sha256(v2)?:/);
    expect(meta.sourcePath).toBe(testLib);
    expect(meta.buildId).toMatch(/^[a-f0-9]{8}$/);
  });

  it("skips publish when content unchanged", async () => {
    const { publish } = await import("../core/publisher.js");
    await publish(testLib);
    const result = await publish(testLib);
    expect(result.skipped).toBe(true);
  });

  it("re-publishes when content changes", async () => {
    const { publish } = await import("../core/publisher.js");
    const first = await publish(testLib);
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "updated";');
    const result = await publish(testLib);
    expect(result.skipped).toBe(false);
    expect(result.buildId).toMatch(/^[a-f0-9]{8}$/);
    expect(result.buildId).not.toBe(first.buildId);
  });

  it("applies publishConfig field overrides", async () => {
    const { publish } = await import("../core/publisher.js");

    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "test-lib",
        version: "1.0.0",
        main: "src/index.ts",
        files: ["dist"],
        publishConfig: {
          main: "dist/index.js",
          types: "dist/index.d.ts",
        },
      })
    );

    const result = await publish(testLib);
    expect(result.skipped).toBe(false);

    const storePkg = JSON.parse(
      await readFile(
        join(testKNARRHome, "store", "test-lib@1.0.0", "package", "package.json"),
        "utf-8"
      )
    );
    expect(storePkg.main).toBe("dist/index.js");
    expect(storePkg.types).toBe("dist/index.d.ts");
    expect(storePkg.publishConfig).toBeUndefined();
  });

  it("uses publishConfig.directory as publish root", async () => {
    const { publish } = await import("../core/publisher.js");

    // Create a package where publishConfig.directory points to dist/
    await mkdir(join(testLib, "dist"), { recursive: true });
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "from-dist";');
    await writeFile(
      join(testLib, "dist", "package.json"),
      JSON.stringify({ name: "test-lib", version: "1.0.0", main: "index.js" })
    );
    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "test-lib",
        version: "1.0.0",
        publishConfig: { directory: "dist" },
      })
    );

    const result = await publish(testLib);
    expect(result.skipped).toBe(false);

    // Files should come from dist/
    const storeIndex = join(
      testKNARRHome, "store", "test-lib@1.0.0", "package", "index.js"
    );
    expect(await exists(storeIndex)).toBe(true);
    expect(await readFile(storeIndex, "utf-8")).toBe('module.exports = "from-dist";');
  });
});

describe("inject", () => {
  it("copies files to consumer node_modules", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "npm");
    expect(result.copied).toBeGreaterThan(0);

    const injectedFile = join(
      testConsumer,
      "node_modules",
      "test-lib",
      "dist",
      "index.js"
    );
    expect(await exists(injectedFile)).toBe(true);
    expect(await readFile(injectedFile, "utf-8")).toBe('module.exports = "hello";');
  });

  it("removes stale bin links when package bins change", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "bin-lib",
        version: "1.0.0",
        files: ["dist"],
        bin: { "old-bin": "dist/old.js" },
      })
    );
    await writeFile(join(testLib, "dist", "old.js"), "#!/usr/bin/env node\n");
    await publish(testLib);
    let entry = await getStoreEntry("bin-lib", "1.0.0");
    await inject(entry!, testConsumer, "npm");
    await expect(lstat(join(testConsumer, "node_modules", ".bin", "old-bin"))).resolves.toBeDefined();

    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "bin-lib",
        version: "1.0.0",
        files: ["dist"],
        bin: { "new-bin": "dist/new.js" },
      })
    );
    await rm(join(testLib, "dist", "old.js"));
    await writeFile(join(testLib, "dist", "new.js"), "#!/usr/bin/env node\n");
    await publish(testLib);
    entry = await getStoreEntry("bin-lib", "1.0.0");
    await inject(entry!, testConsumer, "npm");

    await expect(lstat(join(testConsumer, "node_modules", ".bin", "old-bin"))).rejects.toThrow();
    await expect(lstat(join(testConsumer, "node_modules", ".bin", "new-bin"))).resolves.toBeDefined();
  });
});

describe("tracker", () => {
  it("records and reads link state", async () => {
    const { addLink, getLink, readConsumerState, removeLink } = await import(
      "../core/tracker.js"
    );

    await addLink(testConsumer, "test-lib", {
      version: "1.0.0",
      contentHash: "sha256:abc",
      linkedAt: new Date().toISOString(),
      sourcePath: testLib,
      backupExists: false,
      packageManager: "npm",
      buildId: "deadbeef",
    });

    const link = await getLink(testConsumer, "test-lib");
    expect(link).not.toBeNull();
    expect(link!.version).toBe("1.0.0");

    const state = await readConsumerState(testConsumer);
    expect(Object.keys(state.links)).toHaveLength(1);

    await removeLink(testConsumer, "test-lib");
    const removed = await getLink(testConsumer, "test-lib");
    expect(removed).toBeNull();
  });

  it("manages global consumers registry", async () => {
    const { registerConsumer, getConsumers, unregisterConsumer } = await import(
      "../core/tracker.js"
    );

    await registerConsumer("test-lib", testConsumer);
    let consumers = await getConsumers("test-lib");
    expect(consumers).toHaveLength(1);

    await unregisterConsumer("test-lib", testConsumer);
    consumers = await getConsumers("test-lib");
    expect(consumers).toHaveLength(0);
  });
});

describe("incremental copy on push", () => {
  it("only copies changed files", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await publish(testLib);
    let entry = await getStoreEntry("test-lib", "1.0.0");
    await inject(entry!, testConsumer, "npm");

    // Modify one file
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v2";');
    await publish(testLib);
    entry = await getStoreEntry("test-lib", "1.0.0");

    const result = await inject(entry!, testConsumer, "npm");
    // Only the changed file should be copied
    expect(result.copied).toBe(1);
    expect(result.skipped).toBeGreaterThan(0);
  });
});

describe("backup and restore", () => {
  it("backs up and restores existing package", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject, backupExisting, restoreBackup } = await import(
      "../core/injector.js"
    );

    // Simulate an npm-installed version
    const nmDir = join(testConsumer, "node_modules", "test-lib");
    await mkdir(nmDir, { recursive: true });
    await writeFile(join(nmDir, "index.js"), "original");

    // Backup, then inject Knarr version
    const hasBackup = await backupExisting(testConsumer, "test-lib", "npm");
    expect(hasBackup).toBe(true);

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    await inject(entry!, testConsumer, "npm");

    // Verify Knarr version is injected
    expect(
      await readFile(join(nmDir, "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "hello";');

    // Restore original
    const restored = await restoreBackup(testConsumer, "test-lib", "npm");
    expect(restored).toBe(true);
    expect(await readFile(join(nmDir, "index.js"), "utf-8")).toBe("original");
  });

  it("restores original bin links when restoring a backup", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject, backupExisting, restoreBackup } = await import(
      "../core/injector.js"
    );
    const { createBinLinks } = await import("../utils/bin-linker.js");

    const nmDir = join(testConsumer, "node_modules", "test-lib");
    await mkdir(join(nmDir, "bin"), { recursive: true });
    await writeFile(
      join(nmDir, "package.json"),
      JSON.stringify({
        name: "test-lib",
        version: "1.0.0",
        bin: { "orig-cli": "bin/orig.js" },
      })
    );
    await writeFile(join(nmDir, "bin", "orig.js"), '#!/usr/bin/env node\nconsole.log("original");');
    await createBinLinks(testConsumer, "test-lib", {
      name: "test-lib",
      version: "1.0.0",
      bin: { "orig-cli": "bin/orig.js" },
    });

    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "test-lib",
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
        bin: { "knarr-cli": "dist/cli.js" },
      })
    );
    await writeFile(join(testLib, "dist", "cli.js"), '#!/usr/bin/env node\nconsole.log("knarr");');

    const hasBackup = await backupExisting(testConsumer, "test-lib", "npm");
    expect(hasBackup).toBe(true);

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    await inject(entry!, testConsumer, "npm");

    expect(await exists(join(testConsumer, "node_modules", ".bin", "orig-cli"))).toBe(false);
    expect(await exists(join(testConsumer, "node_modules", ".bin", "knarr-cli"))).toBe(true);

    const restored = await restoreBackup(testConsumer, "test-lib", "npm");
    expect(restored).toBe(true);
    expect(await exists(join(testConsumer, "node_modules", ".bin", "orig-cli"))).toBe(true);
    expect(await exists(join(testConsumer, "node_modules", ".bin", "knarr-cli"))).toBe(false);
  });
});

describe("rollback", () => {
  it("pushes the restored history build without republishing current source", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");
    const { addLink, registerConsumer } = await import("../core/tracker.js");
    const rollbackCommand = await import("../commands/rollback.js");

    const first = await publish(testLib);
    const firstEntry = await getStoreEntry("test-lib", "1.0.0");
    await inject(firstEntry!, testConsumer, "npm");
    await addLink(testConsumer, "test-lib", {
      version: "1.0.0",
      contentHash: firstEntry!.meta.contentHash,
      linkedAt: new Date().toISOString(),
      sourcePath: testLib,
      backupExists: false,
      packageManager: "npm",
      buildId: firstEntry!.meta.buildId ?? "",
    });
    await registerConsumer("test-lib", testConsumer);

    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v2";');
    await publish(testLib);

    const originalCwd = process.cwd();
    process.chdir(testLib);
    try {
      await rollbackCommand.default.run?.({
        args: { "build-id": first.buildId, yes: true },
      } as any);
    } finally {
      process.chdir(originalCwd);
    }

    const restoredEntry = await getStoreEntry("test-lib", "1.0.0");
    expect(
      await readFile(join(restoredEntry!.packageDir, "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "hello";');
    expect(
      await readFile(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "hello";');
  });

  it("reports rollback consumer push failures in one JSON result", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { addLink, registerConsumer } = await import("../core/tracker.js");
    const rollbackCommand = await import("../commands/rollback.js");

    const first = await publish(testLib);
    const firstEntry = await getStoreEntry("test-lib", "1.0.0");
    await writeFile(join(testLib, "dist", "index.js"), 'module.exports = "v2";');
    await publish(testLib);

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );
    const external = await mkdtemp(join(tmpdir(), "KNARR-external-target-"));
    await symlink(external, join(testConsumer, "node_modules", "test-lib"), "dir");
    await addLink(testConsumer, "test-lib", {
      version: "1.0.0",
      contentHash: firstEntry!.meta.contentHash,
      linkedAt: new Date().toISOString(),
      sourcePath: testLib,
      backupExists: false,
      packageManager: "pnpm",
      buildId: firstEntry!.meta.buildId ?? "",
    });
    await registerConsumer("test-lib", testConsumer);

    const originalCwd = process.cwd();
    const originalArgv = [...process.argv];
    const originalExitCode = process.exitCode;
    const originalConsolaLevel = consola.level;
    const originalLog = console.log;
    const logs: string[] = [];
    let observedExitCode: string | number | undefined;

    process.chdir(testLib);
    process.argv = ["node", "knarr", "--json"];
    process.exitCode = undefined;
    initFlags();
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
    try {
      await rollbackCommand.default.run?.({
        args: { "build-id": first.buildId, yes: true },
      } as any);
      observedExitCode = process.exitCode;
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      initFlags();
      consola.level = originalConsolaLevel;
      await rm(external, { recursive: true, force: true });
    }

    expect(logs).toHaveLength(1);
    const result = JSON.parse(logs[0]) as {
      rolledBack: boolean;
      pushed: boolean;
      pushSummary: { failedConsumers: number };
    };
    expect(result.rolledBack).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushSummary.failedConsumers).toBe(1);
    expect(observedExitCode).toBe(1);
  });
});

describe("scoped packages", () => {
  it("handles @scope/name correctly", async () => {
    const { publish } = await import("../core/publisher.js");
    const { findStoreEntry } = await import("../core/store.js");

    // Create a scoped package
    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "@my-scope/my-lib",
        version: "2.0.0",
        files: ["dist"],
      })
    );

    const result = await publish(testLib);
    expect(result.name).toBe("@my-scope/my-lib");

    // Verify it can be found
    const entry = await findStoreEntry("@my-scope/my-lib");
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe("2.0.0");
  });
});

describe("use command flow", () => {
  it("infers a local package name and links it into the current consumer", async () => {
    const { addPackageToConsumer, readPackageNameFromSource } = await import(
      "../commands/add-flow.js"
    );
    const { readConsumerState } = await import("../core/tracker.js");
    const originalCwd = process.cwd();

    process.chdir(testConsumer);
    try {
      const packageName = await readPackageNameFromSource(testLib);
      expect(packageName).toBe("test-lib");

      await addPackageToConsumer({
        packageArg: packageName,
        from: testLib,
        yes: true,
      });

      expect(
        await exists(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"))
      ).toBe(true);

      const state = await readConsumerState(testConsumer);
      expect(state.links["test-lib"]).toMatchObject({
        version: "1.0.0",
        sourcePath: testLib,
        packageManager: "npm",
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("infers scoped package names from a local package path", async () => {
    const { readPackageNameFromSource } = await import("../commands/add-flow.js");

    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "@my-scope/my-lib",
        version: "2.0.0",
        files: ["dist"],
      })
    );

    await expect(readPackageNameFromSource(testLib)).resolves.toBe("@my-scope/my-lib");
  });
});

describe("add command backup preservation", () => {
  it("does not overwrite the original backup when re-adding an existing link", async () => {
    const { publish } = await import("../core/publisher.js");
    const { addPackageToConsumer } = await import("../commands/add-flow.js");
    const { getConsumerBackupPath } = await import("../utils/paths.js");

    const installedDir = join(testConsumer, "node_modules", "test-lib");
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, "index.js"), "original install");
    await publish(testLib);

    const originalCwd = process.cwd();
    process.chdir(testConsumer);
    try {
      await addPackageToConsumer({ packageArg: "test-lib", yes: true });
      await addPackageToConsumer({ packageArg: "test-lib", yes: true });
    } finally {
      process.chdir(originalCwd);
    }

    const backupDir = getConsumerBackupPath(testConsumer, "test-lib");
    expect(await readFile(join(backupDir, "index.js"), "utf-8")).toBe("original install");
  });
});

describe("yarn support", () => {
  it("injects into yarn pnpm-linker .store virtual store", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Set up consumer as a yarn project with pnpm linker
    await writeFile(join(testConsumer, "yarn.lock"), "");
    await writeFile(join(testConsumer, ".yarnrc.yml"), "nodeLinker: pnpm\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );

    // Yarn's pnpm linker points node_modules/<pkg> at .store/<entry>/package.
    const yarnStorePkgDir = join(
      testConsumer,
      "node_modules",
      ".store",
      "test-lib-npm-1.0.0-abcdef1234",
      "package"
    );
    await mkdir(yarnStorePkgDir, { recursive: true });
    await writeFile(join(yarnStorePkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));
    await symlink(
      join(".store", "test-lib-npm-1.0.0-abcdef1234", "package"),
      join(testConsumer, "node_modules", "test-lib"),
      "dir"
    );

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "yarn");
    expect(result.copied).toBeGreaterThan(0);

    const directEntry = await lstat(join(testConsumer, "node_modules", "test-lib"));
    expect(directEntry.isSymbolicLink()).toBe(true);
    const injectedFile = join(yarnStorePkgDir, "dist", "index.js");
    expect(await exists(injectedFile)).toBe(true);
  });

  it("honors yarn pnpmStoreFolder configuration", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "yarn.lock"), "");
    await writeFile(
      join(testConsumer, ".yarnrc.yml"),
      "nodeLinker: pnpm\npnpmStoreFolder: .cache/.store\n"
    );
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );

    const yarnStorePkgDir = join(
      testConsumer,
      ".cache",
      ".store",
      "test-lib-npm-1.0.0-abcdef1234",
      "package"
    );
    await mkdir(yarnStorePkgDir, { recursive: true });
    await writeFile(join(yarnStorePkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));
    await symlink(
      join("..", ".cache", ".store", "test-lib-npm-1.0.0-abcdef1234", "package"),
      join(testConsumer, "node_modules", "test-lib"),
      "dir"
    );

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    const result = await inject(entry!, testConsumer, "yarn");

    expect(result.copied).toBeGreaterThan(0);
    expect(await exists(join(yarnStorePkgDir, "dist", "index.js"))).toBe(true);
  });

  it("injects directly for yarn node-modules linker", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Set up consumer as a yarn project with node-modules linker
    await writeFile(join(testConsumer, "yarn.lock"), "");
    await writeFile(join(testConsumer, ".yarnrc.yml"), "nodeLinker: node-modules\n");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "yarn");
    expect(result.copied).toBeGreaterThan(0);

    const injectedFile = join(testConsumer, "node_modules", "test-lib", "dist", "index.js");
    expect(await exists(injectedFile)).toBe(true);
  });

  it("injects directly for yarn classic (no .yarnrc.yml)", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "yarn.lock"), "");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "yarn");
    expect(result.copied).toBeGreaterThan(0);

    const injectedFile = join(testConsumer, "node_modules", "test-lib", "dist", "index.js");
    expect(await exists(injectedFile)).toBe(true);
  });

  it("detectYarnNodeLinker returns correct values in integration context", async () => {
    await writeFile(join(testConsumer, ".yarnrc.yml"), "nodeLinker: pnpm\n");
    expect(await detectYarnNodeLinker(testConsumer)).toBe("pnpm");

    await writeFile(join(testConsumer, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    expect(await detectYarnNodeLinker(testConsumer)).toBe("node-modules");

    await writeFile(join(testConsumer, ".yarnrc.yml"), "nodeLinker: pnp\n");
    expect(await detectYarnNodeLinker(testConsumer)).toBe("pnp");
  });
});

describe("pnpm injection", () => {
  it("injects into pnpm .pnpm/ virtual store", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Create pnpm lockfile and .pnpm/ structure
    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );
    const pnpmPkgDir = join(
      testConsumer,
      "node_modules",
      ".pnpm",
      "test-lib@1.0.0",
      "node_modules",
      "test-lib"
    );
    await mkdir(pnpmPkgDir, { recursive: true });
    await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "pnpm");
    expect(result.copied).toBeGreaterThan(0);

    // Files should be in the .pnpm/ virtual store
    const injectedFile = join(pnpmPkgDir, "dist", "index.js");
    expect(await exists(injectedFile)).toBe(true);
    expect(await readFile(injectedFile, "utf-8")).toBe('module.exports = "hello";');
  });

  it("honors pnpm virtualStoreDir metadata outside node_modules", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );
    await writeFile(
      join(testConsumer, "node_modules", ".modules.yaml"),
      JSON.stringify({ virtualStoreDir: "../.pnpm" })
    );

    const pnpmPkgDir = join(
      testConsumer,
      ".pnpm",
      "test-lib@1.0.0",
      "node_modules",
      "test-lib"
    );
    await mkdir(pnpmPkgDir, { recursive: true });
    await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));
    await symlink(
      join("..", ".pnpm", "test-lib@1.0.0", "node_modules", "test-lib"),
      join(testConsumer, "node_modules", "test-lib"),
      "dir"
    );

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    const result = await inject(entry!, testConsumer, "pnpm");

    expect(result.copied).toBeGreaterThan(0);
    expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(true);
  });

  it("honors pnpm global virtual store links from metadata", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );

    const nodeModulesDir = join(testConsumer, "node_modules");
    const globalVirtualStore = join(testKNARRHome, "store", "v10", "links");
    await writeFile(
      join(nodeModulesDir, ".modules.yaml"),
      JSON.stringify({
        virtualStoreDir: relative(nodeModulesDir, globalVirtualStore).replace(/\\/g, "/"),
      })
    );

    const pnpmPkgDir = join(
      globalVirtualStore,
      "@",
      "test-lib",
      "1.0.0",
      "abc123",
      "node_modules",
      "test-lib"
    );
    await mkdir(pnpmPkgDir, { recursive: true });
    await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));
    await symlink(relative(nodeModulesDir, pnpmPkgDir), join(nodeModulesDir, "test-lib"), "dir");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    const result = await inject(entry!, testConsumer, "pnpm");

    expect(result.copied).toBeGreaterThan(0);
    expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(true);
  });

  it("handles scoped packages in .pnpm/", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Create scoped package
    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "@my-scope/ui-kit",
        version: "2.0.0",
        files: ["dist"],
      })
    );

    // Set up pnpm structure with encoded scoped name (@scope+name)
    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "@my-scope/ui-kit": "2.0.0" },
      })
    );
    const pnpmPkgDir = join(
      testConsumer,
      "node_modules",
      ".pnpm",
      "@my-scope+ui-kit@2.0.0",
      "node_modules",
      "@my-scope",
      "ui-kit"
    );
    await mkdir(pnpmPkgDir, { recursive: true });
    await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "@my-scope/ui-kit", version: "2.0.0" }));

    await publish(testLib);
    const entry = await getStoreEntry("@my-scope/ui-kit", "2.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "pnpm");
    expect(result.copied).toBeGreaterThan(0);
    expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(true);
  });

  it("matches exact version when multiple versions exist in .pnpm/", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );

    // Create two versions in .pnpm/
    for (const ver of ["1.0.0", "2.0.0"]) {
      const pnpmPkgDir = join(
        testConsumer,
        "node_modules",
        ".pnpm",
        `test-lib@${ver}`,
        "node_modules",
        "test-lib"
      );
      await mkdir(pnpmPkgDir, { recursive: true });
      await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: ver }));
    }

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "pnpm");
    expect(result.copied).toBeGreaterThan(0);

    // Should inject into the 1.0.0 dir, not 2.0.0
    const correct = join(testConsumer, "node_modules", ".pnpm", "test-lib@1.0.0", "node_modules", "test-lib", "dist", "index.js");
    const wrong = join(testConsumer, "node_modules", ".pnpm", "test-lib@2.0.0", "node_modules", "test-lib", "dist", "index.js");
    expect(await exists(correct)).toBe(true);
    expect(await exists(wrong)).toBe(false);
  });

  it("accepts .pnpm candidates when the consumer path resolves through a symlink", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    const aliasParent = await mkdtemp(join(tmpdir(), "KNARR-consumer-alias-"));
    const aliasConsumer = join(aliasParent, "consumer");
    await symlink(testConsumer, aliasConsumer, "dir");

    try {
      await writeFile(join(aliasConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      await writeFile(
        join(aliasConsumer, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: { "test-lib": "1.0.0" },
        })
      );
      const pnpmPkgDir = join(
        aliasConsumer,
        "node_modules",
        ".pnpm",
        "test-lib@1.0.0",
        "node_modules",
        "test-lib"
      );
      await mkdir(pnpmPkgDir, { recursive: true });
      await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));

      await publish(testLib);
      const entry = await getStoreEntry("test-lib", "1.0.0");
      const result = await inject(entry!, aliasConsumer, "pnpm");

      expect(result.copied).toBeGreaterThan(0);
      expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(true);
    } finally {
      await rm(aliasParent, { recursive: true, force: true });
    }
  });

  it("accepts direct package directories when the consumer path resolves through a symlink", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    const aliasParent = await mkdtemp(join(tmpdir(), "KNARR-consumer-alias-"));
    const aliasConsumer = join(aliasParent, "consumer");
    await symlink(testConsumer, aliasConsumer, "dir");

    try {
      await writeFile(join(aliasConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const installedDir = join(aliasConsumer, "node_modules", "test-lib");
      await mkdir(installedDir, { recursive: true });
      await writeFile(join(installedDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));

      await publish(testLib);
      const entry = await getStoreEntry("test-lib", "1.0.0");
      const result = await inject(entry!, aliasConsumer, "pnpm");

      expect(result.copied).toBeGreaterThan(0);
      expect(await exists(join(installedDir, "dist", "index.js"))).toBe(true);
    } finally {
      await rm(aliasParent, { recursive: true, force: true });
    }
  });

  it("does not scan undeclared .pnpm entries", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const pnpmPkgDir = join(
      testConsumer,
      "node_modules",
      ".pnpm",
      "test-lib@1.0.0",
      "node_modules",
      "test-lib"
    );
    await mkdir(pnpmPkgDir, { recursive: true });
    await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    const result = await inject(entry!, testConsumer, "pnpm");

    expect(result.copied).toBeGreaterThan(0);
    expect(await exists(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"))).toBe(true);
    expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(false);
  });

  it("refuses pnpm symlinks that resolve outside the consumer virtual store", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const external = await mkdtemp(join(tmpdir(), "KNARR-external-target-"));
    await symlink(external, join(testConsumer, "node_modules", "test-lib"), "dir");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");

    await expect(inject(entry!, testConsumer, "pnpm")).rejects.toThrow(
      "resolves outside a configured pnpm virtual store"
    );

    await rm(external, { recursive: true, force: true });
  });

  it("refuses .pnpm fallback candidates that resolve outside the consumer virtual store", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );
    const external = await mkdtemp(join(tmpdir(), "KNARR-external-target-"));
    const pnpmNodeModules = join(
      testConsumer,
      "node_modules",
      ".pnpm",
      "test-lib@1.0.0",
      "node_modules"
    );
    await mkdir(pnpmNodeModules, { recursive: true });
    await symlink(external, join(pnpmNodeModules, "test-lib"), "dir");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");

    try {
      await expect(inject(entry!, testConsumer, "pnpm")).rejects.toThrow(
        "resolves outside a configured pnpm virtual store"
      );
      expect(await exists(join(external, "dist", "index.js"))).toBe(false);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });

  it("does not fall back to a different .pnpm version for declared packages", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );
    const wrongVersionDir = join(
      testConsumer,
      "node_modules",
      ".pnpm",
      "test-lib@2.0.0",
      "node_modules",
      "test-lib"
    );
    await mkdir(wrongVersionDir, { recursive: true });
    await writeFile(
      join(wrongVersionDir, "package.json"),
      JSON.stringify({ name: "test-lib", version: "2.0.0" })
    );

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    const result = await inject(entry!, testConsumer, "pnpm");

    expect(result.copied).toBeGreaterThan(0);
    expect(await exists(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"))).toBe(true);
    expect(await exists(join(wrongVersionDir, "dist", "index.js"))).toBe(false);
  });

  it("falls back to direct path when no .pnpm/ structure exists", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    expect(entry).not.toBeNull();

    const result = await inject(entry!, testConsumer, "pnpm");
    expect(result.copied).toBeGreaterThan(0);

    // Should fall back to direct node_modules path
    const directFile = join(testConsumer, "node_modules", "test-lib", "dist", "index.js");
    expect(await exists(directFile)).toBe(true);
  });

  it("remove restores backups into pnpm virtual store without replacing the top-level symlink", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject, backupExisting } = await import("../core/injector.js");
    const { removeSinglePackage } = await import("../commands/remove.js");

    await writeFile(join(testConsumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(testConsumer, "package.json"),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        dependencies: { "test-lib": "1.0.0" },
      })
    );

    const pnpmPkgDir = join(
      testConsumer,
      "node_modules",
      ".pnpm",
      "test-lib@1.0.0",
      "node_modules",
      "test-lib"
    );
    await mkdir(pnpmPkgDir, { recursive: true });
    await writeFile(join(pnpmPkgDir, "package.json"), JSON.stringify({ name: "test-lib", version: "1.0.0" }));
    await writeFile(join(pnpmPkgDir, "index.js"), "original");
    await symlink(
      join(".pnpm", "test-lib@1.0.0", "node_modules", "test-lib"),
      join(testConsumer, "node_modules", "test-lib"),
      "dir"
    );

    const hasBackup = await backupExisting(testConsumer, "test-lib", "pnpm");
    expect(hasBackup).toBe(true);

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");
    await inject(entry!, testConsumer, "pnpm");
    expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(true);

    await removeSinglePackage(testConsumer, "test-lib", {
      backupExists: true,
      packageManager: "pnpm",
    });

    const topLevelEntry = await lstat(join(testConsumer, "node_modules", "test-lib"));
    expect(topLevelEntry.isSymbolicLink()).toBe(true);
    expect(await readFile(join(pnpmPkgDir, "index.js"), "utf-8")).toBe("original");
    expect(await exists(join(pnpmPkgDir, "dist", "index.js"))).toBe(false);
  });
});

describe("missing transitive deps", () => {
  it("detects missing dependencies", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { checkMissingDeps } = await import("../core/injector.js");

    // Create lib with dependencies
    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "test-lib",
        version: "1.0.0",
        files: ["dist"],
        dependencies: {
          lodash: "^4.0.0",
          "not-installed": "^1.0.0",
        },
      })
    );

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");

    // Install lodash mock but not "not-installed"
    await mkdir(join(testConsumer, "node_modules", "lodash"), {
      recursive: true,
    });

    const missing = await checkMissingDeps(entry!, testConsumer);
    expect(missing).toContain("not-installed");
    expect(missing).not.toContain("lodash");
  });

  it("detects missing non-optional peerDependencies", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { checkMissingDeps } = await import("../core/injector.js");

    await writeFile(
      join(testLib, "package.json"),
      JSON.stringify({
        name: "test-lib",
        version: "1.0.0",
        files: ["dist"],
        peerDependencies: {
          react: "^18.0.0",
          "optional-peer": "^1.0.0",
        },
        peerDependenciesMeta: {
          "optional-peer": { optional: true },
        },
      })
    );

    await publish(testLib);
    const entry = await getStoreEntry("test-lib", "1.0.0");

    const missing = await checkMissingDeps(entry!, testConsumer);
    // react is required peer dep and not installed → missing
    expect(missing).toContain("react");
    // optional-peer is optional → not missing
    expect(missing).not.toContain("optional-peer");
  });
});
