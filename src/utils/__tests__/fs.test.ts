import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
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
} from "../fs.js";

const originalArgv = [...process.argv];

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

  it("creates parent directories", async () => {
    const src = join(tempDir, "src.txt");
    const dest = join(tempDir, "sub", "dir", "dest.txt");
    await writeFile(src, "hello");
    await copyWithCoW(src, dest);
    expect(await readFile(dest, "utf-8")).toBe("hello");
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

  it("skips file via mtime fast path on second copy", async () => {
    const src = join(tempDir, "src");
    const dest = join(tempDir, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "hello world");

    // First copy sets mtime on dest to match src
    const first = await incrementalCopy(src, dest);
    expect(first.copied).toBe(1);

    // Second copy should skip via mtime fast-path (no hashing needed)
    const second = await incrementalCopy(src, dest);
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(1);
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
