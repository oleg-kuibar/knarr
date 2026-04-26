/**
 * Scale benchmarks: synthetic 60-file package to stress-test incremental paths.
 * Validates that mtime fast-skip and hash-based diffing work at realistic scale.
 */
import { describe, bench, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { exists, removeDir } from "../utils/fs.js";
import { resolvePackFiles } from "../utils/pack-list.js";
import { publish } from "../core/publisher.js";
import { inject } from "../core/injector.js";
import { getStoreEntry } from "../core/store.js";
import type { PackageJson, StoreEntry } from "../types.js";

let largePackageDir: string;
let KNARRHome: string;
let consumerDir: string;
let largePkg: PackageJson;
let savedKNARRHome: string | undefined;

/** Generate a synthetic package with many files of varying sizes */
async function createLargeFixture(dir: string): Promise<PackageJson> {
  const pkg: PackageJson = {
    name: "bench-large-lib",
    version: "1.0.0",
    files: ["dist"],
  };
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));

  const distDir = join(dir, "dist");
  await mkdir(distDir, { recursive: true });

  // Create subdirectories to simulate a real package layout
  for (const sub of ["components", "utils", "hooks", "styles"]) {
    await mkdir(join(distDir, sub), { recursive: true });
  }

  // 40 small JS files (1-4KB) — typical component output
  for (let i = 0; i < 40; i++) {
    const sub = ["components", "utils", "hooks"][i % 3];
    const size = 1024 + i * 80; // 1KB to ~4KB
    await writeFile(join(distDir, sub, `file-${i}.js`), randomBytes(size));
  }

  // 10 declaration files (~500 bytes each)
  for (let i = 0; i < 10; i++) {
    await writeFile(
      join(distDir, "components", `file-${i}.d.ts`),
      randomBytes(512)
    );
  }

  // 5 medium files (10-50KB) — bundled chunks
  for (let i = 0; i < 5; i++) {
    const size = 10240 + i * 10240;
    await writeFile(join(distDir, `chunk-${i}.js`), randomBytes(size));
  }

  // 3 CSS files (2-8KB)
  for (let i = 0; i < 3; i++) {
    const size = 2048 + i * 3072;
    await writeFile(join(distDir, "styles", `style-${i}.css`), randomBytes(size));
  }

  // 1 index file + 1 package entry
  await writeFile(join(distDir, "index.js"), randomBytes(2048));
  await writeFile(join(distDir, "index.d.ts"), randomBytes(512));

  return pkg;
}

beforeAll(async () => {
  // Create synthetic large package
  largePackageDir = await mkdtemp(join(tmpdir(), "KNARR-bench-large-pkg-"));
  largePkg = await createLargeFixture(largePackageDir);

  // Isolate store
  savedKNARRHome = process.env.KNARR_HOME;
  KNARRHome = await mkdtemp(join(tmpdir(), "KNARR-bench-scale-home-"));
  process.env.KNARR_HOME = KNARRHome;

  // Set up consumer
  consumerDir = await mkdtemp(join(tmpdir(), "KNARR-bench-scale-consumer-"));
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "bench-scale-consumer", version: "1.0.0" })
  );
  await writeFile(join(consumerDir, "package-lock.json"), "{}");
  await mkdir(join(consumerDir, "node_modules"), { recursive: true });

  // Initial publish
  await publish(largePackageDir, { force: true });
});

afterAll(async () => {
  if (savedKNARRHome !== undefined) {
    process.env.KNARR_HOME = savedKNARRHome;
  } else {
    delete process.env.KNARR_HOME;
  }
  await rm(KNARRHome, { recursive: true, force: true });
  await rm(consumerDir, { recursive: true, force: true });
  await rm(largePackageDir, { recursive: true, force: true });
});

describe("scale: resolvePackFiles", () => {
  bench("60 files", async () => {
    await resolvePackFiles(largePackageDir, largePkg);
  });
});

describe("scale: publish", () => {
  bench(
    "full (force, 60 files)",
    async () => {
      await publish(largePackageDir, { force: true });
    },
    {
      async setup() {
        const entryPath = join(KNARRHome, "store");
        if (await exists(entryPath)) {
          await removeDir(entryPath);
        }
      },
    }
  );

  bench("skip (no changes, 60 files)", async () => {
    await publish(largePackageDir);
  });
});

describe("scale: inject", () => {
  bench(
    "cold (60 files)",
    async () => {
      const entry = (await getStoreEntry(
        largePkg.name,
        largePkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        await publish(largePackageDir, { force: true });
        const pkgDir = join(consumerDir, "node_modules", largePkg.name);
        if (await exists(pkgDir)) {
          await removeDir(pkgDir);
        }
      },
    }
  );

  bench(
    "incremental (no changes, 60 files)",
    async () => {
      const entry = (await getStoreEntry(
        largePkg.name,
        largePkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        await publish(largePackageDir, { force: true });
        const entry = (await getStoreEntry(
          largePkg.name,
          largePkg.version
        )) as StoreEntry;
        await inject(entry, consumerDir, "npm");
      },
    }
  );

  bench(
    "incremental (1 file changed, 60 files)",
    async () => {
      const entry = (await getStoreEntry(
        largePkg.name,
        largePkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        // Publish and do initial inject
        await publish(largePackageDir, { force: true });
        const entry = (await getStoreEntry(
          largePkg.name,
          largePkg.version
        )) as StoreEntry;
        await inject(entry, consumerDir, "npm");
        // Modify one file in the store entry to simulate a change
        const changedFile = join(entry.packageDir, "dist", "index.js");
        await writeFile(changedFile, randomBytes(2048));
        // Touch the file with a new mtime to ensure mtime differs
        const future = new Date(Date.now() + 1000);
        await utimes(changedFile, future, future);
      },
    }
  );
});
