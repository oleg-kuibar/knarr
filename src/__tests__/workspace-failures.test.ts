import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { doPushAll } from "../core/batch-push.js";
import { addLink, registerConsumer } from "../core/tracker.js";
import { getStoreEntry } from "../core/store.js";
import { runInitialWorkspaceWatchBuilds } from "../core/push-engine.js";
import { consola } from "../utils/console.js";
import { exists } from "../utils/fs.js";

let testKNARRHome: string;

beforeEach(async () => {
  testKNARRHome = await mkdtemp(join(tmpdir(), "KNARR-home-"));
  process.env.KNARR_HOME = testKNARRHome;
});

afterEach(async () => {
  delete process.env.KNARR_HOME;
  await rm(testKNARRHome, { recursive: true, force: true });
});

describe("workspace failure handling", () => {
  it("skips dependents after push failures and continues independent packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "KNARR-workspace-failure-"));
    const consumer = await mkdtemp(join(tmpdir(), "KNARR-consumer-"));
    const external = await mkdtemp(join(tmpdir(), "KNARR-external-"));

    try {
      await writeWorkspaceRoot(root);
      await writeWorkspacePackage(join(root, "packages", "dep-a"), "dep-a");
      await writeWorkspacePackage(join(root, "packages", "dep-b"), "dep-b", {
        "dep-a": "workspace:*",
      });
      await writeWorkspacePackage(join(root, "packages", "dep-c"), "dep-c");

      await writeFile(
        join(consumer, "package.json"),
        JSON.stringify({ name: "consumer", version: "1.0.0" }, null, 2)
      );
      await mkdir(join(consumer, "node_modules"), { recursive: true });
      await symlink(external, join(consumer, "node_modules", "dep-a"), "dir");
      await addLink(consumer, "dep-a", {
        version: "1.0.0",
        contentHash: "old",
        linkedAt: new Date().toISOString(),
        sourcePath: join(root, "packages", "dep-a"),
        backupExists: false,
        packageManager: "pnpm",
        buildId: "old",
      });
      await registerConsumer("dep-a", consumer);

      await expect(doPushAll(root, { runScripts: false })).rejects.toThrow(
        "Failed to push 1 workspace package"
      );

      expect(await getStoreEntry("dep-a", "1.0.0")).not.toBeNull();
      expect(await getStoreEntry("dep-b", "1.0.0")).toBeNull();
      expect(await getStoreEntry("dep-c", "1.0.0")).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(consumer, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it("skips initial builds for dependents after dependency build failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "KNARR-workspace-build-"));

    try {
      await writeWorkspaceRoot(root);
      await writeWorkspacePackage(
        join(root, "packages", "dep-a"),
        "dep-a",
        {},
        "process.exit(1);\n"
      );
      await writeWorkspacePackage(join(root, "packages", "dep-b"), "dep-b", {
        "dep-a": "workspace:*",
      });
      await writeWorkspacePackage(join(root, "packages", "dep-c"), "dep-c");

      const result = await withoutExpectedBuildFailureOutput(() =>
        runInitialWorkspaceWatchBuilds(root, watchArgs())
      );

      expect(result.canPush).toBe(true);
      expect(result.failedPackages).toEqual(new Set(["dep-a"]));
      expect(result.skippedPackages).toEqual(new Set(["dep-b"]));
      expect(
        await exists(join(root, "packages", "dep-b", "dist", "build-ran.txt"))
      ).toBe(false);
      expect(
        await exists(join(root, "packages", "dep-c", "dist", "build-ran.txt"))
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function withoutExpectedBuildFailureOutput<T>(fn: () => Promise<T>): Promise<T> {
  const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
  try {
    return await fn();
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
}

async function writeWorkspaceRoot(root: string): Promise<void> {
  await mkdir(join(root, "packages"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, workspaces: ["packages/*"] }, null, 2)
  );
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n"
  );
}

async function writeWorkspacePackage(
  dir: string,
  name: string,
  dependencies: Record<string, string> = {},
  buildScript = "require('node:fs').writeFileSync('dist/build-ran.txt', 'ran');\n"
): Promise<void> {
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(
    join(dir, "dist", "index.js"),
    `module.exports = "${name}";\n`
  );
  await writeFile(join(dir, "build.cjs"), buildScript);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
        scripts: { build: "node build.cjs" },
        ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
      },
      null,
      2
    )
  );
}

function watchArgs(): {
  build?: string;
  "skip-build"?: boolean;
  debounce?: string;
  cooldown?: string;
  notify?: boolean;
  "no-cascade"?: boolean;
} {
  return {
    build: "node build.cjs",
    "skip-build": false,
    notify: false,
    "no-cascade": false,
  };
}
