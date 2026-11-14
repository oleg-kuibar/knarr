import { test, beforeAll, afterAll } from "vitest";
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

// Vitest 5 bench API: benchmarks are registered from a test's context.
// `beforeEach` hooks run before every iteration (excluded from timing);
// `beforeAll` hooks run once per warmup/run phase.

async function injectApiClient(): Promise<void> {
  const entry = (await getStoreEntry(apiPkg.name, apiPkg.version)) as StoreEntry;
  await inject(entry, consumerDir, "npm");
}

async function clearStore(): Promise<void> {
  const entryPath = join(KNARRHome, "store");
  if (await exists(entryPath)) {
    await removeDir(entryPath);
  }
}

async function clearInjectedPackage(): Promise<void> {
  const pkgDir = join(consumerDir, "node_modules", apiPkg.name);
  if (await exists(pkgDir)) {
    await removeDir(pkgDir);
  }
}

test("resolvePackFiles", async ({ bench }) => {
  await bench("api-client", async () => {
    await resolvePackFiles(API_CLIENT_DIR, apiPkg);
  }).run();
});

test("publish", async ({ bench }) => {
  await bench.compare(
    // Clear the store before every iteration so each one is a real publish
    bench("full (force)", { beforeEach: clearStore }, async () => {
      await publish(API_CLIENT_DIR, { force: true });
    }),
    // Hot path in watch mode: hash matches, publish is skipped
    bench(
      "skip (no changes)",
      { beforeAll: () => publish(API_CLIENT_DIR, { force: true }).then(() => {}) },
      async () => {
        await publish(API_CLIENT_DIR);
      }
    )
  );
});

test("inject", async ({ bench }) => {
  await bench.compare(
    bench(
      "cold (empty node_modules)",
      {
        beforeAll: () => publish(API_CLIENT_DIR, { force: true }).then(() => {}),
        beforeEach: clearInjectedPackage,
      },
      injectApiClient
    ),
    bench(
      "incremental (no changes)",
      {
        async beforeAll() {
          await publish(API_CLIENT_DIR, { force: true });
          await injectApiClient();
        },
      },
      injectApiClient
    )
  );
});

test("push (publish + inject)", async ({ bench }) => {
  await bench.compare(
    bench(
      "full cycle",
      {
        async beforeEach() {
          await clearStore();
          await clearInjectedPackage();
        },
      },
      async () => {
        await publish(API_CLIENT_DIR, { force: true });
        await injectApiClient();
      }
    ),
    // Simulates the hot path in watch mode: publish skips, inject skips
    bench(
      "no-op (nothing changed)",
      {
        async beforeAll() {
          await publish(API_CLIENT_DIR, { force: true });
          await injectApiClient();
        },
      },
      async () => {
        await publish(API_CLIENT_DIR);
        await injectApiClient();
      }
    )
  );
});
