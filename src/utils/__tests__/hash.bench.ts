import { test, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { computeContentHash } from "../hash.js";

let tempDir: string;
let aggregateFiles: string[]; // 50 files for computeContentHash

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "KNARR-bench-hash-"));

  aggregateFiles = [];
  for (let i = 0; i < 50; i++) {
    const f = join(tempDir, `file-${String(i).padStart(3, "0")}.bin`);
    // Mix of sizes: mostly small (1-4KB), a few medium (10-50KB)
    const size = i < 45 ? 1024 + (i * 64) : 10240 + (i * 1024);
    await writeFile(f, randomBytes(size));
    aggregateFiles.push(f);
  }
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("computeContentHash", async ({ bench }) => {
  await bench("50 files (SHA-256 aggregate)", async () => {
    await computeContentHash(aggregateFiles, tempDir);
  }).run();
});
