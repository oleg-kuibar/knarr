import { describe, bench, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { exists, removeDir } from "../utils/fs.js";
import { resolvePackFiles } from "../utils/pack-list.js";
import { publish } from "../core/publisher.js";
import { inject } from "../core/injector.js";
import { getStoreEntry } from "../core/store.js";
import type { PackageJson, StoreEntry } from "../types.js";

const API_CLIENT_DIR = resolve(__dirname, "../../examples/packages/api-client");

let KNARRHome: string;
let consumerDir: string;
let apiPkg: PackageJson;
let savedKNARRHome: string | undefined;

beforeAll(async () => {
  // Verify fixture is built
  if (!(await exists(join(API_CLIENT_DIR, "dist/index.js")))) {
    throw new Error(
      "api-client must be built before running benchmarks.\n" +
        "Run: cd examples/packages/api-client && pnpm install && pnpm tsup"
    );
  }

  apiPkg = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      join(API_CLIENT_DIR, "package.json"),
      "utf-8"
    )
  ) as PackageJson;

  // Isolate store
  savedKNARRHome = process.env.KNARR_HOME;
  KNARRHome = await mkdtemp(join(tmpdir(), "KNARR-bench-home-"));
  process.env.KNARR_HOME = KNARRHome;

  // Set up consumer with node_modules and a lockfile (npm-style)
  consumerDir = await mkdtemp(join(tmpdir(), "KNARR-bench-consumer-"));
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "bench-consumer", version: "1.0.0" })
  );
  await writeFile(join(consumerDir, "package-lock.json"), "{}");
  await mkdir(join(consumerDir, "node_modules"), { recursive: true });

  // Seed the store with an initial publish so inject benches have data
  await publish(API_CLIENT_DIR, { force: true });
});

afterAll(async () => {
  if (savedKNARRHome !== undefined) {
    process.env.KNARR_HOME = savedKNARRHome;
  } else {
    delete process.env.KNARR_HOME;
  }
  await rm(KNARRHome, { recursive: true, force: true });
  await rm(consumerDir, { recursive: true, force: true });
});

describe("resolvePackFiles", () => {
  bench("api-client", async () => {
    await resolvePackFiles(API_CLIENT_DIR, apiPkg);
  });
});

describe("publish", () => {
  bench(
    "full (force)",
    async () => {
      await publish(API_CLIENT_DIR, { force: true });
    },
    {
      async setup() {
        // Clear store to force a real publish each iteration
        const entryPath = join(KNARRHome, "store");
        if (await exists(entryPath)) {
          await removeDir(entryPath);
        }
      },
    }
  );

  bench("skip (no changes)", async () => {
    // Hot path in watch mode: hash matches, publish is skipped
    await publish(API_CLIENT_DIR);
  });
});

describe("inject", () => {
  bench(
    "cold (empty node_modules)",
    async () => {
      const entry = (await getStoreEntry(
        apiPkg.name,
        apiPkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        // Ensure store is populated
        await publish(API_CLIENT_DIR, { force: true });
        // Clear consumer node_modules/<pkg> for a cold inject
        const pkgDir = join(consumerDir, "node_modules", apiPkg.name);
        if (await exists(pkgDir)) {
          await removeDir(pkgDir);
        }
      },
    }
  );

  bench(
    "incremental (no changes)",
    async () => {
      const entry = (await getStoreEntry(
        apiPkg.name,
        apiPkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        // Ensure store is populated and first inject is done
        await publish(API_CLIENT_DIR, { force: true });
        const entry = (await getStoreEntry(
          apiPkg.name,
          apiPkg.version
        )) as StoreEntry;
        await inject(entry, consumerDir, "npm");
      },
    }
  );
});

describe("push (publish + inject)", () => {
  bench(
    "full cycle",
    async () => {
      await publish(API_CLIENT_DIR, { force: true });
      const entry = (await getStoreEntry(
        apiPkg.name,
        apiPkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        // Clear store and consumer for a full push each iteration
        const entryPath = join(KNARRHome, "store");
        if (await exists(entryPath)) {
          await removeDir(entryPath);
        }
        const pkgDir = join(consumerDir, "node_modules", apiPkg.name);
        if (await exists(pkgDir)) {
          await removeDir(pkgDir);
        }
      },
    }
  );

  bench(
    "no-op (nothing changed)",
    async () => {
      // Simulates the hot path in watch mode: publish skips, inject skips
      const result = await publish(API_CLIENT_DIR);
      const entry = (await getStoreEntry(
        apiPkg.name,
        apiPkg.version
      )) as StoreEntry;
      await inject(entry, consumerDir, "npm");
    },
    {
      async setup() {
        // Ensure everything is already published and injected
        await publish(API_CLIENT_DIR, { force: true });
        const entry = (await getStoreEntry(
          apiPkg.name,
          apiPkg.version
        )) as StoreEntry;
        await inject(entry, consumerDir, "npm");
      },
    }
  );
});
