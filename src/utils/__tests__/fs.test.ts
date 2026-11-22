import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, symlink, link, lstat, realpath, utimes } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initFlags } from "../logger.js";
import { resetMutations } from "../dry-run.js";
import {
  copyWithCoW,
  incrementalCopy,
  exists,
  collectFiles,
  moveDir,
  ensurePrivateDir,
  copyDir,
  atomicWriteFile,
} from "../fs.js";

const fsMocks = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fsMocks.rename.mockImplementation(actual.rename);
  return { ...actual, rename: fsMocks.rename };
});
const { rename: actualRename } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const originalArgv = [...process.argv];
const originalPlatform = process.platform;

function lockedError(): NodeJS.ErrnoException {
  return Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
}

function setDryRun(enabled: boolean): void {
  process.argv = enabled ? ["node", "knarr", "--dry-run"] : ["node", "knarr"];
  initFlags();
  resetMutations();
}

describe("copyWithCoW", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    process.argv = [...originalArgv];
    initFlags();
    resetMutations();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("copies a file", async () => {
    const src = join(tempDir, "src.txt");
    const dest = join(tempDir, "dest.txt");
    await writeFile(src, "hello");
    await copyWithCoW(src, dest);
    expect(await readFile(dest, "utf-8")).toBe("hello");
  });

  describe("when Windows holds the destination open", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      fsMocks.rename.mockReset();
      fsMocks.rename.mockImplementation(actualRename);
    });

    it("retries the rename until the lock is released", async () => {
      const src = join(tempDir, "src.txt");
      const dest = join(tempDir, "dest.txt");
      await writeFile(src, "new");
      await writeFile(dest, "old");
      fsMocks.rename.mockRejectedValueOnce(lockedError());

      await copyWithCoW(src, dest);

      expect(await readFile(dest, "utf-8")).toBe("new");
      expect((await readdir(tempDir)).sort()).toEqual(["dest.txt", "src.txt"]);
    });

    it("rejects without leaving a temp file when the lock persists", async () => {
      const src = join(tempDir, "src.txt");
      const dest = join(tempDir, "dest.txt");
      await writeFile(src, "new");
      await writeFile(dest, "old");
      fsMocks.rename.mockRejectedValue(lockedError());

      await expect(copyWithCoW(src, dest)).rejects.toMatchObject({ code: "EPERM" });

      expect(await readFile(dest, "utf-8")).toBe("old");
      expect((await readdir(tempDir)).sort()).toEqual(["dest.txt", "src.txt"]);
    });
  });

  it("creates parent directories", async () => {
    const src = join(tempDir, "src.txt");
    const dest = join(tempDir, "sub", "dir", "dest.txt");
    await writeFile(src, "hello");
    await copyWithCoW(src, dest);
    expect(await readFile(dest, "utf-8")).toBe("hello");
  });

  it("replaces a hardlinked destination without writing through to its other links", async () => {
    const src = join(tempDir, "src.txt");
    const sharedStoreFile = join(tempDir, "store.txt");
    const dest = join(tempDir, "dest.txt");
    await writeFile(src, "local build");
    await writeFile(sharedStoreFile, "registry version");
    await link(sharedStoreFile, dest);

    await copyWithCoW(src, dest);

    expect(await readFile(dest, "utf-8")).toBe("local build");
    expect(await readFile(sharedStoreFile, "utf-8")).toBe("registry version");
    expect(await readdir(tempDir)).toEqual(["dest.txt", "src.txt", "store.txt"]);
  });
});

describe("incrementalCopy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    process.argv = [...originalArgv];
    initFlags();
    resetMutations();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("copies all files on first copy", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");
    await writeFile(join(src, "b.txt"), "bbb");

    const result = await incrementalCopy(src, dest);
    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("aaa");
    expect(await readFile(join(dest, "b.txt"), "utf-8")).toBe("bbb");
  });

  it("skips unchanged files on second copy", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");

    await incrementalCopy(src, dest);
    const result = await incrementalCopy(src, dest);
    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("copies only changed files", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");
    await writeFile(join(src, "b.txt"), "bbb");

    await incrementalCopy(src, dest);
    await writeFile(join(src, "a.txt"), "modified");
    const result = await incrementalCopy(src, dest);
    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("modified");
  });

  it("copies file when content changes but size is preserved", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");

    await incrementalCopy(src, dest);
    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("aaa");

    // Overwrite with same-size but different content
    await writeFile(join(src, "a.txt"), "bbb");
    const result = await incrementalCopy(src, dest);
    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("bbb");
  });

  it("compares large files past the first chunk", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    const size = 3 * 1024 * 1024 + 17;
    await writeFile(join(src, "big.bin"), Buffer.alloc(size, 0xab));
    await writeFile(join(src, "same.bin"), Buffer.alloc(size, 0xcd));
    await incrementalCopy(src, dest);

    const changed = Buffer.alloc(size, 0xab);
    changed[size - 1] = 0x00;
    await writeFile(join(src, "big.bin"), changed);
    const result = await incrementalCopy(src, dest);

    expect(result).toMatchObject({ copied: 1, skipped: 1 });
    expect((await readFile(join(dest, "big.bin"))).equals(changed)).toBe(true);
  });

  it.each([0, 1024 * 1024, 1024 * 1024 + 1, 2 * 1024 * 1024])(
    "detects a last-byte change and skips identical content at %i bytes",
    async (size) => {
      const src = join(tempDir, "src");
      const dest = join(tempDir, "dest");
      await mkdir(src, { recursive: true });
      await writeFile(join(src, "f.bin"), Buffer.alloc(size, 0x11));
      await incrementalCopy(src, dest);

      expect(await incrementalCopy(src, dest)).toMatchObject({ copied: 0, skipped: 1 });
      if (size === 0) return;

      const changed = Buffer.alloc(size, 0x11);
      changed[size - 1] = 0x22;
      await writeFile(join(src, "f.bin"), changed);
      expect(await incrementalCopy(src, dest)).toMatchObject({ copied: 1, skipped: 0 });
      expect((await readFile(join(dest, "f.bin"))).equals(changed)).toBe(true);
    }
  );

  it("replaces a directory that sits where an empty source file goes", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "empty.js"), "");
    await mkdir(join(dest, "empty.js"), { recursive: true });

    const result = await incrementalCopy(src, dest);

    expect(result.copied).toBe(1);
    expect(await readFile(join(dest, "empty.js"), "utf-8")).toBe("");
  });

  it("skips an unchanged file on second copy", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "hello world");

    const first = await incrementalCopy(src, dest);
    expect(first.copied).toBe(1);

    const second = await incrementalCopy(src, dest);
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("copies a same-size file even when its mtime matches the destination", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(src, "a.txt"), "new-marker");
    await writeFile(join(dest, "a.txt"), "old-marker");
    const sameTick = new Date("2026-01-01T00:00:00Z");
    await utimes(join(src, "a.txt"), sameTick, sameTick);
    await utimes(join(dest, "a.txt"), sameTick, sameTick);

    const result = await incrementalCopy(src, dest);

    expect(result.copied).toBe(1);
    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("new-marker");
  });

  it("keeps another live process's temp copy and removes a dead one's", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(src, "a.txt"), "a");
    const liveTemp = join(dest, `a.txt.knarr-tmp-${process.pid}-${randomUUID()}`);
    const deadTemp = join(dest, `a.txt.knarr-tmp-4194305-${randomUUID()}`);
    await writeFile(liveTemp, "in flight");
    await writeFile(deadTemp, "abandoned");

    await incrementalCopy(src, dest);

    expect(await exists(liveTemp)).toBe(true);
    expect(await exists(deadTemp)).toBe(false);
  });

  it("removes files not in source", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");
    await writeFile(join(dest, "a.txt"), "aaa");
    await writeFile(join(dest, "old.txt"), "old");

    const result = await incrementalCopy(src, dest);
    expect(result.removed).toBe(1);
    expect(await exists(join(dest, "old.txt"))).toBe(false);
  });

  it("does not touch destinations when copying new files in dry-run mode", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");
    setDryRun(true);

    const result = await incrementalCopy(src, dest);

    expect(result.copied).toBe(1);
    expect(await exists(join(dest, "a.txt"))).toBe(false);
  });

  it("handles a destination file becoming a source directory", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "entry"), "file");
    await incrementalCopy(src, dest);

    await rm(join(src, "entry"));
    await mkdir(join(src, "entry"), { recursive: true });
    await writeFile(join(src, "entry", "index.js"), "nested");

    const result = await incrementalCopy(src, dest);

    expect(result.copied).toBe(1);
    expect(await readFile(join(dest, "entry", "index.js"), "utf-8")).toBe("nested");
  });

  it("handles a destination directory becoming a source file", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(join(src, "entry"), { recursive: true });
    await writeFile(join(src, "entry", "index.js"), "nested");
    await incrementalCopy(src, dest);

    await rm(join(src, "entry"), { recursive: true, force: true });
    await writeFile(join(src, "entry"), "file");

    const result = await incrementalCopy(src, dest);

    expect(result.copied).toBe(1);
    expect(await readFile(join(dest, "entry"), "utf-8")).toBe("file");
  });
});

describe("atomicWriteFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("leaves no temp file behind when the rename fails", async () => {
    await mkdir(join(tempDir, "state.json"));

    await expect(atomicWriteFile(join(tempDir, "state.json"), "{}")).rejects.toThrow();

    expect(await readdir(tempDir)).toEqual(["state.json"]);
  });
});

describe("moveDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("moves a directory via rename on same filesystem", async () => {
    const src = join(tempDir, "src-dir");
    const dest = join(tempDir, "dest-dir");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "hello");

    await moveDir(src, dest);

    expect(await exists(dest)).toBe(true);
    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("hello");
    expect(await exists(src)).toBe(false);
  });

  it("propagates non-EXDEV errors", async () => {
    const src = join(tempDir, "nonexistent");
    const dest = join(tempDir, "dest-dir");

    await expect(moveDir(src, dest)).rejects.toThrow();
  });
});

describe("copyDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("copies a directory tree", async () => {
    const src = join(tempDir, "src");
    await mkdir(join(src, "nested"), { recursive: true });
    await writeFile(join(src, "nested", "a.txt"), "hello");

    await copyDir(src, join(tempDir, "dest"));

    expect(await readFile(join(tempDir, "dest", "nested", "a.txt"), "utf-8")).toBe("hello");
  });

  // npm links file: deps with junctions on Windows. Junctions need no
  // privilege, so this runs on every Windows machine (and as a plain
  // directory symlink elsewhere).
  it("preserves a top-level directory link (npm file: dep layout)", async () => {
    const target = join(tempDir, "lib");
    await mkdir(target);
    await writeFile(join(target, "index.js"), "module.exports = 1;");
    const link = join(tempDir, "node_modules-lib");
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");

    const dest = join(tempDir, "backups", "lib");
    await copyDir(link, dest);

    expect((await lstat(dest)).isSymbolicLink()).toBe(true);
    expect(await realpath(dest)).toBe(await realpath(target));
    expect(await readFile(join(dest, "index.js"), "utf-8")).toBe("module.exports = 1;");
  });
});

describe("ensurePrivateDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates the directory", async () => {
    const dir = join(tempDir, "private", "nested");
    await ensurePrivateDir(dir);
    expect(await exists(dir)).toBe(true);
  });
});

describe("collectFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("collects files recursively", async () => {
    await mkdir(join(tempDir, "sub"), { recursive: true });
    await writeFile(join(tempDir, "a.txt"), "a");
    await writeFile(join(tempDir, "sub", "b.txt"), "b");
    const files = await collectFiles(tempDir);
    expect(files).toHaveLength(2);
  });
});
