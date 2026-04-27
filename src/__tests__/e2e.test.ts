/**
 * End-to-end tests using the real example packages as fixtures.
 *
 * These tests exercise every core KNARR workflow against real built packages
 * (examples/packages/api-client and examples/packages/ui-kit), providing
 * thorough coverage of publish, inject, push, backup/restore, incremental
 * copy, multi-consumer, scoped packages, and error handling.
 *
 * Prerequisites: example packages must have their dist/ built (npm run build
 * in each). The beforeAll hook verifies this.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { exists, collectFiles } from "../utils/fs.js";

// Paths to the real example packages (built with tsup)
const EXAMPLES_ROOT = resolve(__dirname, "../../examples");
const API_CLIENT_DIR = join(EXAMPLES_ROOT, "packages/api-client");
const UI_KIT_DIR = join(EXAMPLES_ROOT, "packages/ui-kit");

let KNARRHome: string;
let consumer1: string;
let consumer2: string;

// Verify example packages are built before running any tests
beforeAll(async () => {
  const apiDist = join(API_CLIENT_DIR, "dist/index.js");
  const uiDist = join(UI_KIT_DIR, "dist/index.js");
  if (!(await exists(apiDist)) || !(await exists(uiDist))) {
    throw new Error(
      "Example packages must be built before running e2e tests.\n" +
        "Run: cd examples/packages/api-client && npm install && npx tsup\n" +
        "     cd examples/packages/ui-kit && npm install && npx tsup"
    );
  }
});

beforeEach(async () => {
  KNARRHome = await mkdtemp(join(tmpdir(), "KNARR-e2e-home-"));
  consumer1 = await mkdtemp(join(tmpdir(), "KNARR-e2e-c1-"));
  consumer2 = await mkdtemp(join(tmpdir(), "KNARR-e2e-c2-"));
  process.env.KNARR_HOME = KNARRHome;

  // Set up both consumers with node_modules and a lockfile
  for (const dir of [consumer1, consumer2]) {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-consumer", version: "1.0.0" })
    );
    await writeFile(join(dir, "package-lock.json"), "{}");
    await mkdir(join(dir, "node_modules"), { recursive: true });
  }
});

afterEach(async () => {
  delete process.env.KNARR_HOME;
  await rm(KNARRHome, { recursive: true, force: true });
  await rm(consumer1, { recursive: true, force: true });
  await rm(consumer2, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────────
// PUBLISH
// ────────────────────────────────────────────────────────────────────────────

describe("publish with real example packages", () => {
  it("publishes @example/api-client (scoped package) to the store", async () => {
    const { publish } = await import("../core/publisher.js");
    const result = await publish(API_CLIENT_DIR);

    expect(result.name).toBe("@example/api-client");
    expect(result.version).toBe("1.0.0");
    expect(result.skipped).toBe(false);
    expect(result.fileCount).toBeGreaterThanOrEqual(2); // at least package.json + dist/index.js
    expect(result.buildId).toMatch(/^[a-f0-9]{8}$/);

    // Verify scoped package encoding in store path
    const storeDir = join(KNARRHome, "store", "@example+api-client@1.0.0");
    expect(await exists(storeDir)).toBe(true);
    expect(await exists(join(storeDir, "package", "package.json"))).toBe(true);
    expect(await exists(join(storeDir, "package", "dist", "index.js"))).toBe(true);
    expect(await exists(join(storeDir, ".knarr-meta.json"))).toBe(true);
  });

  it("publishes @example/ui-kit to the store", async () => {
    const { publish } = await import("../core/publisher.js");
    const result = await publish(UI_KIT_DIR);

    expect(result.name).toBe("@example/ui-kit");
    expect(result.version).toBe("1.0.0");
    expect(result.skipped).toBe(false);
  });

  it("skips re-publish when content is unchanged", async () => {
    const { publish } = await import("../core/publisher.js");
    await publish(API_CLIENT_DIR);
    const second = await publish(API_CLIENT_DIR);
    expect(second.skipped).toBe(true);
    expect(second.contentHash).toMatch(/^sha256(v2)?:[a-f0-9]{64}$/);
  });

  it("stores correct metadata", async () => {
    const { publish } = await import("../core/publisher.js");
    const result = await publish(API_CLIENT_DIR);

    const metaPath = join(
      KNARRHome,
      "store",
      "@example+api-client@1.0.0",
      ".knarr-meta.json"
    );
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    expect(meta.contentHash).toMatch(/^sha256(v2)?:/);
    expect(meta.sourcePath).toBe(API_CLIENT_DIR);
    expect(new Date(meta.publishedAt).getTime()).not.toBeNaN();
    expect(meta.buildId).toMatch(/^[a-f0-9]{8}$/);
    expect(result.buildId).toBe(meta.buildId);
  });

  it("preserves the files field filtering (only dist/ is published)", async () => {
    const { publish } = await import("../core/publisher.js");
    await publish(API_CLIENT_DIR);

    const storePackageDir = join(
      KNARRHome,
      "store",
      "@example+api-client@1.0.0",
      "package"
    );
    const files = await collectFiles(storePackageDir);
    const relPaths = files.map((f) => f.slice(storePackageDir.length + 1).replace(/\\/g, "/"));

    // Should include dist/ files and package.json
    expect(relPaths).toContainEqual("package.json");
    expect(relPaths.some((p) => p.startsWith("dist/"))).toBe(true);

    // Should NOT include src/ files (not in files field)
    expect(relPaths.some((p) => p.startsWith("src/"))).toBe(false);

    // Should NOT include tsconfig.json, tsup.config.ts
    expect(relPaths).not.toContainEqual("tsconfig.json");
    expect(relPaths).not.toContainEqual("tsup.config.ts");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// STORE OPERATIONS
// ────────────────────────────────────────────────────────────────────────────

describe("store operations", () => {
  it("lists all published packages", async () => {
    const { publish } = await import("../core/publisher.js");
    const { listStoreEntries } = await import("../core/store.js");

    await publish(API_CLIENT_DIR);
    await publish(UI_KIT_DIR);

    const entries = await listStoreEntries();
    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["@example/api-client", "@example/ui-kit"]);
  });

  it("finds a package by name (any version)", async () => {
    const { publish } = await import("../core/publisher.js");
    const { findStoreEntry } = await import("../core/store.js");

    await publish(API_CLIENT_DIR);
    const entry = await findStoreEntry("@example/api-client");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("@example/api-client");
    expect(entry!.version).toBe("1.0.0");
  });

  it("returns null for non-existent package", async () => {
    const { findStoreEntry } = await import("../core/store.js");
    const entry = await findStoreEntry("does-not-exist");
    expect(entry).toBeNull();
  });

  it("returns empty list when store is empty", async () => {
    const { listStoreEntries } = await import("../core/store.js");
    const entries = await listStoreEntries();
    expect(entries).toEqual([]);
  });

  it("removes a store entry", async () => {
    const { publish } = await import("../core/publisher.js");
    const { removeStoreEntry, getStoreEntry } = await import("../core/store.js");

    await publish(API_CLIENT_DIR);
    await removeStoreEntry("@example/api-client", "1.0.0");

    const entry = await getStoreEntry("@example/api-client", "1.0.0");
    expect(entry).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// INJECT INTO CONSUMER
// ────────────────────────────────────────────────────────────────────────────

describe("inject scoped packages into node_modules", () => {
  it("injects @example/api-client with correct directory structure", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await publish(API_CLIENT_DIR);
    const entry = await getStoreEntry("@example/api-client", "1.0.0");
    const result = await inject(entry!, consumer1, "npm");

    expect(result.copied).toBeGreaterThan(0);

    // Scoped package creates @example/api-client directory
    const pkgDir = join(consumer1, "node_modules", "@example", "api-client");
    expect(await exists(pkgDir)).toBe(true);
    expect(await exists(join(pkgDir, "package.json"))).toBe(true);
    expect(await exists(join(pkgDir, "dist", "index.js"))).toBe(true);

    // Verify the content is actually the built package
    const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("@example/api-client");
  });

  it("injected package content matches store content exactly", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await publish(UI_KIT_DIR);
    const entry = await getStoreEntry("@example/ui-kit", "1.0.0");
    await inject(entry!, consumer1, "npm");

    // Compare a file from store vs node_modules
    const storeFile = await readFile(
      join(entry!.packageDir, "dist", "index.js"),
      "utf-8"
    );
    const nmFile = await readFile(
      join(consumer1, "node_modules", "@example", "ui-kit", "dist", "index.js"),
      "utf-8"
    );
    expect(nmFile).toBe(storeFile);
  });

  it("reports zero copies on second inject (incremental)", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    await publish(API_CLIENT_DIR);
    const entry = await getStoreEntry("@example/api-client", "1.0.0");

    await inject(entry!, consumer1, "npm");
    const second = await inject(entry!, consumer1, "npm");
    expect(second.copied).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MULTI-CONSUMER PUSH
// ────────────────────────────────────────────────────────────────────────────

describe("multi-consumer push", () => {
  it("pushes to multiple consumers after publish", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");
    const { registerConsumer, getConsumers, addLink } = await import(
      "../core/tracker.js"
    );

    // Publish both packages
    await publish(API_CLIENT_DIR);
    const entry = await getStoreEntry("@example/api-client", "1.0.0");

    // Register both consumers
    await registerConsumer("@example/api-client", consumer1);
    await registerConsumer("@example/api-client", consumer2);

    // Track links in both consumers
    for (const c of [consumer1, consumer2]) {
      await addLink(c, "@example/api-client", {
        version: "1.0.0",
        contentHash: entry!.meta.contentHash,
        linkedAt: new Date().toISOString(),
        sourcePath: API_CLIENT_DIR,
        backupExists: false,
        packageManager: "npm",
        buildId: entry!.meta.buildId ?? "",
      });
    }

    // Verify consumers are registered
    const consumers = await getConsumers("@example/api-client");
    expect(consumers).toHaveLength(2);

    // Inject into both (simulating push)
    const r1 = await inject(entry!, consumer1, "npm");
    const r2 = await inject(entry!, consumer2, "npm");
    expect(r1.copied).toBeGreaterThan(0);
    expect(r2.copied).toBeGreaterThan(0);

    // Verify both consumers have the package
    for (const c of [consumer1, consumer2]) {
      expect(
        await exists(join(c, "node_modules", "@example", "api-client", "dist", "index.js"))
      ).toBe(true);
    }
  });

  it("does not duplicate consumer registrations", async () => {
    const { registerConsumer, getConsumers } = await import(
      "../core/tracker.js"
    );

    await registerConsumer("@example/api-client", consumer1);
    await registerConsumer("@example/api-client", consumer1); // duplicate
    await registerConsumer("@example/api-client", consumer1); // triple

    const consumers = await getConsumers("@example/api-client");
    expect(consumers).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BACKUP / RESTORE / REMOVE
// ────────────────────────────────────────────────────────────────────────────

describe("backup, restore, and remove flow", () => {
  it("backs up existing package before inject", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject, backupExisting } = await import("../core/injector.js");

    // Simulate an npm-installed version of @example/api-client
    const nmDir = join(consumer1, "node_modules", "@example", "api-client");
    await mkdir(nmDir, { recursive: true });
    await writeFile(join(nmDir, "package.json"), '{"name":"@example/api-client","version":"0.9.0"}');
    await writeFile(join(nmDir, "original.js"), "// original npm version");

    // Backup
    const backed = await backupExisting(consumer1, "@example/api-client", "npm");
    expect(backed).toBe(true);

    // Verify backup exists
    const backupDir = join(consumer1, ".knarr", "backups", "@example+api-client");
    expect(await exists(backupDir)).toBe(true);
    expect(await exists(join(backupDir, "original.js"))).toBe(true);

    // Now inject Knarr version
    await publish(API_CLIENT_DIR);
    const entry = await getStoreEntry("@example/api-client", "1.0.0");
    await inject(entry!, consumer1, "npm");

    // Verify Knarr version replaced original
    const pkg = JSON.parse(await readFile(join(nmDir, "package.json"), "utf-8"));
    expect(pkg.version).toBe("1.0.0");
    expect(await exists(join(nmDir, "original.js"))).toBe(false); // removed by incremental copy
  });

  it("restores backup after remove", async () => {
    const { backupExisting, restoreBackup } = await import("../core/injector.js");

    // Create original installation
    const nmDir = join(consumer1, "node_modules", "@example", "api-client");
    await mkdir(nmDir, { recursive: true });
    await writeFile(join(nmDir, "index.js"), "// npm-installed v0.9.0");

    // Backup + verify
    await backupExisting(consumer1, "@example/api-client", "npm");

    // Overwrite with something else
    await writeFile(join(nmDir, "index.js"), "// Knarr version");

    // Restore
    const restored = await restoreBackup(consumer1, "@example/api-client", "npm");
    expect(restored).toBe(true);

    const content = await readFile(join(nmDir, "index.js"), "utf-8");
    expect(content).toBe("// npm-installed v0.9.0");

    // Backup should be cleaned up after restore
    const backupDir = join(consumer1, ".knarr", "backups", "@example+api-client");
    expect(await exists(backupDir)).toBe(false);
  });

  it("returns false when no backup exists", async () => {
    const { restoreBackup } = await import("../core/injector.js");
    const result = await restoreBackup(consumer1, "@example/api-client", "npm");
    expect(result).toBe(false);
  });

  it("returns false when backing up non-existent package", async () => {
    const { backupExisting } = await import("../core/injector.js");
    const result = await backupExisting(consumer1, "non-existent", "npm");
    expect(result).toBe(false);
  });

  it("removeInjected removes the package from node_modules", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject, removeInjected } = await import("../core/injector.js");

    await publish(UI_KIT_DIR);
    const entry = await getStoreEntry("@example/ui-kit", "1.0.0");
    await inject(entry!, consumer1, "npm");

    const nmDir = join(consumer1, "node_modules", "@example", "ui-kit");
    expect(await exists(nmDir)).toBe(true);

    await removeInjected(consumer1, "@example/ui-kit", "npm");
    expect(await exists(nmDir)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TRACKER STATE MANAGEMENT
// ────────────────────────────────────────────────────────────────────────────

describe("tracker state management", () => {
  it("tracks multiple linked packages in a consumer", async () => {
    const { addLink, readConsumerState } = await import("../core/tracker.js");

    const base = {
      contentHash: "sha256:abc",
      linkedAt: new Date().toISOString(),
      sourcePath: "/some/path",
      backupExists: false,
      packageManager: "npm" as const,
      buildId: "aabb1122",
    };

    await addLink(consumer1, "@example/api-client", { ...base, version: "1.0.0" });
    await addLink(consumer1, "@example/ui-kit", { ...base, version: "1.0.0" });

    const state = await readConsumerState(consumer1);
    expect(Object.keys(state.links)).toHaveLength(2);
    expect(state.links["@example/api-client"]).toBeDefined();
    expect(state.links["@example/ui-kit"]).toBeDefined();
    expect(state.version).toBe("1");
  });

  it("overwrites link entry when re-adding same package", async () => {
    const { addLink, getLink } = await import("../core/tracker.js");

    const base = {
      contentHash: "sha256:old",
      linkedAt: new Date().toISOString(),
      sourcePath: "/path",
      backupExists: false,
      packageManager: "npm" as const,
      buildId: "ccdd3344",
    };

    await addLink(consumer1, "my-lib", { ...base, version: "1.0.0" });
    await addLink(consumer1, "my-lib", { ...base, version: "2.0.0", contentHash: "sha256:new" });

    const link = await getLink(consumer1, "my-lib");
    expect(link!.version).toBe("2.0.0");
    expect(link!.contentHash).toBe("sha256:new");
  });

  it("handles empty/missing state file gracefully", async () => {
    const { readConsumerState } = await import("../core/tracker.js");

    // Non-existent directory
    const state = await readConsumerState("/nonexistent/path");
    expect(state.version).toBe("1");
    expect(state.links).toEqual({});
  });

  it("handles corrupted state file gracefully", async () => {
    const { readConsumerState } = await import("../core/tracker.js");

    // Write invalid JSON
    await mkdir(join(consumer1, ".knarr"), { recursive: true });
    await writeFile(join(consumer1, ".knarr", "state.json"), "NOT JSON {{{");

    const state = await readConsumerState(consumer1);
    expect(state.version).toBe("1");
    expect(state.links).toEqual({});
  });

  it("unregisters consumer and cleans up empty entries", async () => {
    const { registerConsumer, unregisterConsumer, getConsumers } = await import(
      "../core/tracker.js"
    );
    const { readConsumersRegistry } = await import("../core/tracker.js");

    await registerConsumer("my-lib", consumer1);
    await unregisterConsumer("my-lib", consumer1);

    const consumers = await getConsumers("my-lib");
    expect(consumers).toHaveLength(0);

    // The key should be deleted entirely
    const registry = await readConsumersRegistry();
    expect(registry["my-lib"]).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MISSING TRANSITIVE DEPENDENCIES
// ────────────────────────────────────────────────────────────────────────────

describe("transitive dependency checking", () => {
  it("returns empty when no dependencies field", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { checkMissingDeps } = await import("../core/injector.js");

    // ui-kit has no dependencies
    await publish(UI_KIT_DIR);
    const entry = await getStoreEntry("@example/ui-kit", "1.0.0");
    const missing = await checkMissingDeps(entry!, consumer1);
    expect(missing).toEqual([]);
  });

  it("detects when all deps are missing", async () => {
    const { checkMissingDeps } = await import("../core/injector.js");
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");

    // Create a temp lib with deps
    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-lib-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(join(tempLib, "dist", "index.js"), "");
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({
        name: "dep-lib",
        version: "1.0.0",
        files: ["dist"],
        dependencies: { react: "^19.0.0", lodash: "^4.0.0" },
      })
    );

    await publish(tempLib);
    const entry = await getStoreEntry("dep-lib", "1.0.0");
    const missing = await checkMissingDeps(entry!, consumer1);
    expect(missing).toContain("react");
    expect(missing).toContain("lodash");
    expect(missing).toHaveLength(2);

    await rm(tempLib, { recursive: true, force: true });
  });

  it("does not flag installed deps as missing", async () => {
    const { checkMissingDeps } = await import("../core/injector.js");
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");

    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-lib-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(join(tempLib, "dist", "index.js"), "");
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({
        name: "dep-lib2",
        version: "1.0.0",
        files: ["dist"],
        dependencies: { react: "^19.0.0", lodash: "^4.0.0" },
      })
    );

    // Simulate lodash being installed
    await mkdir(join(consumer1, "node_modules", "lodash"), { recursive: true });

    await publish(tempLib);
    const entry = await getStoreEntry("dep-lib2", "1.0.0");
    const missing = await checkMissingDeps(entry!, consumer1);
    expect(missing).toContain("react");
    expect(missing).not.toContain("lodash");

    await rm(tempLib, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PUBLISH ERROR HANDLING
// ────────────────────────────────────────────────────────────────────────────

describe("publish error handling", () => {
  it("throws when package.json is missing", async () => {
    const { publish } = await import("../core/publisher.js");
    const emptyDir = await mkdtemp(join(tmpdir(), "KNARR-empty-"));
    await expect(publish(emptyDir)).rejects.toThrow("No package.json");
    await rm(emptyDir, { recursive: true, force: true });
  });

  it("throws when name field is missing", async () => {
    const { publish } = await import("../core/publisher.js");
    const dir = await mkdtemp(join(tmpdir(), "KNARR-noname-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    await expect(publish(dir)).rejects.toThrow("missing 'name'");
    await rm(dir, { recursive: true, force: true });
  });

  it("throws when version field is missing", async () => {
    const { publish } = await import("../core/publisher.js");
    const dir = await mkdtemp(join(tmpdir(), "KNARR-nover-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test" }));
    await expect(publish(dir)).rejects.toThrow("missing 'version'");
    await rm(dir, { recursive: true, force: true });
  });

  it("throws when package identity would escape store paths", async () => {
    const { publish } = await import("../core/publisher.js");
    const dir = await mkdtemp(join(tmpdir(), "KNARR-invalid-name-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "../evil", version: "1.0.0" })
    );
    await expect(publish(dir)).rejects.toThrow("Invalid package name");
    await rm(dir, { recursive: true, force: true });
  });

  it("throws when package version is not semver", async () => {
    const { publish } = await import("../core/publisher.js");
    const dir = await mkdtemp(join(tmpdir(), "KNARR-invalid-version-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", version: "../1.0.0" })
    );
    await expect(publish(dir)).rejects.toThrow("Invalid package version");
    await rm(dir, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// WORKSPACE PROTOCOL REWRITING
// ────────────────────────────────────────────────────────────────────────────

describe("workspace protocol rewriting on publish", () => {
  it("rewrites workspace:* to actual version in store copy", async () => {
    const { publish } = await import("../core/publisher.js");

    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-ws-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(join(tempLib, "dist", "index.js"), "");
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({
        name: "ws-lib",
        version: "3.2.1",
        files: ["dist"],
        dependencies: {
          "dep-a": "workspace:*",
          "dep-b": "workspace:^",
          "dep-c": "workspace:~",
          "dep-d": "workspace:1.5.0",
          "dep-e": "^2.0.0", // non-workspace, should be untouched
        },
      })
    );

    await publish(tempLib);

    // Read the published package.json from the store
    const storePkg = JSON.parse(
      await readFile(
        join(KNARRHome, "store", "ws-lib@3.2.1", "package", "package.json"),
        "utf-8"
      )
    );

    expect(storePkg.dependencies["dep-a"]).toBe("3.2.1"); // workspace:* → version
    expect(storePkg.dependencies["dep-b"]).toBe("^3.2.1"); // workspace:^ → ^version
    expect(storePkg.dependencies["dep-c"]).toBe("~3.2.1"); // workspace:~ → ~version
    expect(storePkg.dependencies["dep-d"]).toBe("1.5.0"); // workspace:1.5.0 → 1.5.0
    expect(storePkg.dependencies["dep-e"]).toBe("^2.0.0"); // untouched

    // Verify the source package.json was NOT modified
    const sourcePkg = JSON.parse(await readFile(join(tempLib, "package.json"), "utf-8"));
    expect(sourcePkg.dependencies["dep-a"]).toBe("workspace:*");

    await rm(tempLib, { recursive: true, force: true });
  });

  it("does not rewrite package.json when no workspace deps exist", async () => {
    const { publish } = await import("../core/publisher.js");

    // api-client has no workspace deps — its package.json should be byte-for-byte copy
    await publish(API_CLIENT_DIR);

    const sourceContent = await readFile(join(API_CLIENT_DIR, "package.json"), "utf-8");
    const storeContent = await readFile(
      join(KNARRHome, "store", "@example+api-client@1.0.0", "package", "package.json"),
      "utf-8"
    );
    // Content should be identical (not reformatted)
    expect(JSON.parse(storeContent)).toEqual(JSON.parse(sourceContent));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PNPM INJECTION
// ────────────────────────────────────────────────────────────────────────────

describe("pnpm injection strategy", () => {
  it("falls back to direct path when no .pnpm structure exists", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Consumer with pnpm lockfile but no .pnpm/ yet
    await writeFile(join(consumer1, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");

    await publish(UI_KIT_DIR);
    const entry = await getStoreEntry("@example/ui-kit", "1.0.0");
    const result = await inject(entry!, consumer1, "pnpm");

    // Should fall back to direct node_modules path
    expect(result.copied).toBeGreaterThan(0);
    expect(
      await exists(join(consumer1, "node_modules", "@example", "ui-kit", "dist", "index.js"))
    ).toBe(true);
  });

  it("injects into .pnpm virtual store when it exists", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Simulate pnpm virtual store structure
    const pnpmTarget = join(
      consumer1,
      "node_modules",
      ".pnpm",
      "@example+ui-kit@1.0.0",
      "node_modules",
      "@example",
      "ui-kit"
    );
    await mkdir(pnpmTarget, { recursive: true });
    await writeFile(join(pnpmTarget, "package.json"), '{"name":"@example/ui-kit","version":"0.0.1"}');

    await publish(UI_KIT_DIR);
    const entry = await getStoreEntry("@example/ui-kit", "1.0.0");
    const result = await inject(entry!, consumer1, "pnpm");

    expect(result.copied).toBeGreaterThan(0);

    // Verify files were written into the .pnpm target
    expect(await exists(join(pnpmTarget, "dist", "index.js"))).toBe(true);
    const pkg = JSON.parse(await readFile(join(pnpmTarget, "package.json"), "utf-8"));
    expect(pkg.version).toBe("1.0.0"); // Updated from store
  });
});

// ────────────────────────────────────────────────────────────────────────────
// FULL END-TO-END WORKFLOW
// ────────────────────────────────────────────────────────────────────────────

describe("full workflow: publish → add → push → restore → remove", () => {
  it("complete lifecycle with two packages and two consumers", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry, listStoreEntries } = await import("../core/store.js");
    const { inject, backupExisting, restoreBackup, removeInjected } = await import(
      "../core/injector.js"
    );
    const {
      addLink,
      removeLink,
      getLink,
      registerConsumer,
      unregisterConsumer,
      getConsumers,
      readConsumerState,
    } = await import("../core/tracker.js");

    // ── Step 1: Publish both packages ──
    const apiResult = await publish(API_CLIENT_DIR);
    const uiResult = await publish(UI_KIT_DIR);
    expect(apiResult.skipped).toBe(false);
    expect(uiResult.skipped).toBe(false);

    const storeEntries = await listStoreEntries();
    expect(storeEntries).toHaveLength(2);

    // ── Step 2: Add both packages to consumer1 ──
    const apiEntry = await getStoreEntry("@example/api-client", "1.0.0");
    const uiEntry = await getStoreEntry("@example/ui-kit", "1.0.0");

    // Inject
    await inject(apiEntry!, consumer1, "npm");
    await inject(uiEntry!, consumer1, "npm");

    // Track
    const linkBase = {
      linkedAt: new Date().toISOString(),
      backupExists: false,
      packageManager: "npm" as const,
    };
    await addLink(consumer1, "@example/api-client", {
      ...linkBase,
      version: apiEntry!.version,
      contentHash: apiEntry!.meta.contentHash,
      sourcePath: apiEntry!.meta.sourcePath,
      buildId: apiEntry!.meta.buildId ?? "",
    });
    await addLink(consumer1, "@example/ui-kit", {
      ...linkBase,
      version: uiEntry!.version,
      contentHash: uiEntry!.meta.contentHash,
      sourcePath: uiEntry!.meta.sourcePath,
      buildId: uiEntry!.meta.buildId ?? "",
    });
    await registerConsumer("@example/api-client", consumer1);
    await registerConsumer("@example/ui-kit", consumer1);

    // Verify state
    const state = await readConsumerState(consumer1);
    expect(Object.keys(state.links)).toHaveLength(2);

    // Verify files exist
    expect(
      await exists(join(consumer1, "node_modules", "@example", "api-client", "dist", "index.js"))
    ).toBe(true);
    expect(
      await exists(join(consumer1, "node_modules", "@example", "ui-kit", "dist", "index.js"))
    ).toBe(true);

    // ── Step 3: Add api-client to consumer2 ──
    await inject(apiEntry!, consumer2, "npm");
    await addLink(consumer2, "@example/api-client", {
      ...linkBase,
      version: apiEntry!.version,
      contentHash: apiEntry!.meta.contentHash,
      sourcePath: apiEntry!.meta.sourcePath,
      buildId: apiEntry!.meta.buildId ?? "",
    });
    await registerConsumer("@example/api-client", consumer2);

    const apiConsumers = await getConsumers("@example/api-client");
    expect(apiConsumers).toHaveLength(2);

    // ── Step 4: Simulate npm install wiping node_modules ──
    await rm(join(consumer1, "node_modules", "@example"), {
      recursive: true,
      force: true,
    });
    expect(
      await exists(join(consumer1, "node_modules", "@example", "api-client"))
    ).toBe(false);

    // ── Step 5: Restore ──
    // Re-inject all linked packages for consumer1
    const restoreState = await readConsumerState(consumer1);
    for (const [name, link] of Object.entries(restoreState.links)) {
      const entry = await getStoreEntry(name, link.version);
      expect(entry).not.toBeNull();
      await inject(entry!, consumer1, link.packageManager);
    }

    // Verify restored
    expect(
      await exists(join(consumer1, "node_modules", "@example", "api-client", "dist", "index.js"))
    ).toBe(true);
    expect(
      await exists(join(consumer1, "node_modules", "@example", "ui-kit", "dist", "index.js"))
    ).toBe(true);

    // ── Step 6: Remove api-client from consumer1 ──
    await removeInjected(consumer1, "@example/api-client", "npm");
    await removeLink(consumer1, "@example/api-client");
    await unregisterConsumer("@example/api-client", consumer1);

    const finalState = await readConsumerState(consumer1);
    expect(Object.keys(finalState.links)).toHaveLength(1);
    expect(finalState.links["@example/ui-kit"]).toBeDefined();
    expect(finalState.links["@example/api-client"]).toBeUndefined();

    // consumer2 should still have api-client
    const remainingConsumers = await getConsumers("@example/api-client");
    expect(remainingConsumers).toHaveLength(1);
    expect(
      await exists(join(consumer2, "node_modules", "@example", "api-client", "dist", "index.js"))
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// INCREMENTAL PUSH AFTER CONTENT CHANGE
// ────────────────────────────────────────────────────────────────────────────

describe("incremental push after source changes", () => {
  it("detects and copies only changed files after re-publish", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    // Create a temp lib so we can modify files
    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-inc-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({ name: "inc-lib", version: "1.0.0", files: ["dist"] })
    );
    await writeFile(join(tempLib, "dist", "a.js"), "const a = 1;");
    await writeFile(join(tempLib, "dist", "b.js"), "const b = 2;");
    await writeFile(join(tempLib, "dist", "c.js"), "const c = 3;");

    // Initial publish + inject
    await publish(tempLib);
    let entry = await getStoreEntry("inc-lib", "1.0.0");
    const first = await inject(entry!, consumer1, "npm");
    expect(first.copied).toBe(4); // 3 js files + package.json

    // Modify only one file
    await writeFile(join(tempLib, "dist", "b.js"), "const b = 999;");
    await publish(tempLib);
    entry = await getStoreEntry("inc-lib", "1.0.0");

    const second = await inject(entry!, consumer1, "npm");
    expect(second.copied).toBe(1); // only b.js changed
    expect(second.skipped).toBe(3); // a.js, c.js, package.json unchanged

    // Verify the changed content propagated
    const content = await readFile(
      join(consumer1, "node_modules", "inc-lib", "dist", "b.js"),
      "utf-8"
    );
    expect(content).toBe("const b = 999;");

    await rm(tempLib, { recursive: true, force: true });
  });

  it("removes files from consumer that were deleted from source", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry } = await import("../core/store.js");
    const { inject } = await import("../core/injector.js");

    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-del-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({ name: "del-lib", version: "1.0.0", files: ["dist"] })
    );
    await writeFile(join(tempLib, "dist", "keep.js"), "keep");
    await writeFile(join(tempLib, "dist", "remove-me.js"), "remove");

    // Publish + inject both files
    await publish(tempLib);
    let entry = await getStoreEntry("del-lib", "1.0.0");
    await inject(entry!, consumer1, "npm");
    expect(
      await exists(join(consumer1, "node_modules", "del-lib", "dist", "remove-me.js"))
    ).toBe(true);

    // Delete file from source, re-publish
    await rm(join(tempLib, "dist", "remove-me.js"));
    await publish(tempLib);
    entry = await getStoreEntry("del-lib", "1.0.0");

    const result = await inject(entry!, consumer1, "npm");
    expect(result.removed).toBeGreaterThan(0);

    // File should be gone from consumer too
    expect(
      await exists(join(consumer1, "node_modules", "del-lib", "dist", "remove-me.js"))
    ).toBe(false);
    expect(
      await exists(join(consumer1, "node_modules", "del-lib", "dist", "keep.js"))
    ).toBe(true);

    await rm(tempLib, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MULTIPLE PACKAGE VERSIONS
// ────────────────────────────────────────────────────────────────────────────

describe("multiple versions in store", () => {
  it("stores multiple versions of the same package independently", async () => {
    const { publish } = await import("../core/publisher.js");
    const { getStoreEntry, listStoreEntries } = await import("../core/store.js");

    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-multi-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(join(tempLib, "dist", "index.js"), "v1");
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({ name: "multi-lib", version: "1.0.0", files: ["dist"] })
    );
    await publish(tempLib);

    // Change version
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({ name: "multi-lib", version: "2.0.0", files: ["dist"] })
    );
    await writeFile(join(tempLib, "dist", "index.js"), "v2");
    await publish(tempLib);

    // Both versions should exist
    const v1 = await getStoreEntry("multi-lib", "1.0.0");
    const v2 = await getStoreEntry("multi-lib", "2.0.0");
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();

    // Content should be different
    const v1Content = await readFile(join(v1!.packageDir, "dist", "index.js"), "utf-8");
    const v2Content = await readFile(join(v2!.packageDir, "dist", "index.js"), "utf-8");
    expect(v1Content).toBe("v1");
    expect(v2Content).toBe("v2");

    // listStoreEntries should show both
    const all = await listStoreEntries();
    const multiEntries = all.filter((e) => e.name === "multi-lib");
    expect(multiEntries).toHaveLength(2);

    await rm(tempLib, { recursive: true, force: true });
  });

  it("findStoreEntry returns the most recently published version", async () => {
    const { publish } = await import("../core/publisher.js");
    const { findStoreEntry } = await import("../core/store.js");

    const tempLib = await mkdtemp(join(tmpdir(), "KNARR-latest-"));
    await mkdir(join(tempLib, "dist"), { recursive: true });
    await writeFile(join(tempLib, "dist", "index.js"), "");
    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({ name: "latest-lib", version: "1.0.0", files: ["dist"] })
    );
    await publish(tempLib);

    // Small delay to ensure different publishedAt timestamps
    await new Promise((r) => setTimeout(r, 50));

    await writeFile(
      join(tempLib, "package.json"),
      JSON.stringify({ name: "latest-lib", version: "2.0.0", files: ["dist"] })
    );
    await publish(tempLib);

    const latest = await findStoreEntry("latest-lib");
    expect(latest!.version).toBe("2.0.0");

    await rm(tempLib, { recursive: true, force: true });
  });
});
