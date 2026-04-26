import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withFileLock } from "../lockfile.js";

describe("withFileLock", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("concurrent locking: two concurrent writes don't corrupt data", async () => {
    const filePath = join(tempDir, "lock-target.json");
    await writeFile(filePath, "0");

    const increment = async () => {
      await withFileLock(filePath, async () => {
        const current = parseInt(await readFile(filePath, "utf-8"), 10);
        // Small delay to increase chance of race condition without lock
        await new Promise((resolve) => setTimeout(resolve, 10));
        await writeFile(filePath, String(current + 1));
      });
    };

    // Run two concurrent increments
    await Promise.all([increment(), increment()]);

    const final = parseInt(await readFile(filePath, "utf-8"), 10);
    expect(final).toBe(2);
  });

  it("lock on non-existent file: creates parent dir and succeeds", async () => {
    const filePath = join(tempDir, "subdir", "new-file.lock");

    const result = await withFileLock(filePath, async () => {
      return "success";
    });

    expect(result).toBe("success");
  });

  it("error propagation: errors from fn() are propagated properly", async () => {
    const filePath = join(tempDir, "error-test.lock");

    await expect(
      withFileLock(filePath, async () => {
        throw new Error("intentional failure");
      })
    ).rejects.toThrow("intentional failure");
  });
});
