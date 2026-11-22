import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exists } from "../utils/fs.js";

let knarrHome: string;
let storeDir: string;

async function writeEntry(dirName: string, publishedAt: Date): Promise<void> {
  const entryDir = join(storeDir, dirName);
  await mkdir(join(entryDir, "package"), { recursive: true });
  await writeFile(
    join(entryDir, ".knarr-meta.json"),
    JSON.stringify({
      contentHash: "sha256:abc",
      publishedAt: publishedAt.toISOString(),
      sourcePath: "/src/foo",
    })
  );
}

beforeEach(async () => {
  knarrHome = await mkdtemp(join(tmpdir(), "knarr-store-"));
  storeDir = join(knarrHome, "store");
  process.env.KNARR_HOME = knarrHome;
});

afterEach(async () => {
  delete process.env.KNARR_HOME;
  await rm(knarrHome, { recursive: true, force: true });
});

describe("store listing", () => {
  it("ignores lock, temp and invalid directories", async () => {
    const { listStoreEntries, findStoreEntry } = await import("../core/store.js");
    await writeEntry("foo@1.0.0", new Date(Date.now() - 60_000));
    await mkdir(join(storeDir, "foo@1.0.0.lock.lk"), { recursive: true });
    await writeEntry("foo@1.0.0-beta.tmp-123-1700000000000", new Date());
    await writeEntry("foo@1.0.0.old-1700000000000", new Date());
    await writeEntry("foo@bar", new Date());

    const entries = await listStoreEntries();
    expect(entries.map((e) => `${e.name}@${e.version}`)).toEqual(["foo@1.0.0"]);
    expect((await findStoreEntry("foo"))?.version).toBe("1.0.0");
  });

  it("lists entries whose names only contain the temp markers", async () => {
    const { listStoreEntries } = await import("../core/store.js");
    await writeEntry("foo.tmp-bar@1.0.0", new Date());
    await writeEntry("x@1.0.0-rc.old-1", new Date());

    const entries = await listStoreEntries();
    expect(entries.map((e) => `${e.name}@${e.version}`).sort()).toEqual(["foo.tmp-bar@1.0.0", "x@1.0.0-rc.old-1"]);
  });
});

describe("clean", () => {
  it("keeps temp directories of a publish that may still be running", async () => {
    const cleanCommand = await import("../commands/clean.js");
    const young = join(storeDir, `foo@1.0.0.tmp-1-${Date.now()}`);
    const old = join(storeDir, `foo@1.0.0.old-${Date.now() - 10 * 60_000}`);
    await mkdir(young, { recursive: true });
    await mkdir(old, { recursive: true });

    await cleanCommand.default.run?.({ args: { yes: true } } as any);

    expect(await exists(young)).toBe(true);
    expect(await exists(old)).toBe(false);
  });

  it("judges a temp directory by its publish time, not its mtime", async () => {
    const cleanCommand = await import("../commands/clean.js");
    const swapped = join(storeDir, `foo@1.0.0.old-${Date.now()}`);
    await mkdir(swapped, { recursive: true });
    const anHourAgo = new Date(Date.now() - 60 * 60_000);
    await utimes(swapped, anHourAgo, anHourAgo);

    await cleanCommand.default.run?.({ args: { yes: true } } as any);

    expect(await exists(swapped)).toBe(true);
  });

  it("leaves directories that only contain the temp markers to the entry pass", async () => {
    const cleanCommand = await import("../commands/clean.js");
    const lookalike = join(storeDir, "foo.tmp-bar@1.0.0");
    await mkdir(lookalike, { recursive: true });
    const anHourAgo = new Date(Date.now() - 60 * 60_000);
    await utimes(lookalike, anHourAgo, anHourAgo);

    await cleanCommand.default.run?.({ args: { yes: true } } as any);

    expect(await exists(lookalike)).toBe(true);
  });
});
