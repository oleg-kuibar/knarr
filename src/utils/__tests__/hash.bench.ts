import { describe, bench, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { computeContentHash, hashFile } from "../hash.js";

let tempDir: string;
let smallFile: string; // 1 KB
let mediumFile: string; // 100 KB
let largeFile: string; // 2 MB (above STREAM_THRESHOLD)
let aggregateFiles: string[]; // 50 files for computeContentHash

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "KNARR-bench-hash-"));

  smallFile = join(tempDir, "small.bin");
  await writeFile(smallFile, randomBytes(1024));

  mediumFile = join(tempDir, "medium.bin");
  await writeFile(mediumFile, randomBytes(100 * 1024));

  largeFile = join(tempDir, "large.bin");
  await writeFile(largeFile, randomBytes(2 * 1024 * 1024));

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

describe("hashFile", () => {
  bench("1 KB (buffered)", async () => {
    await hashFile(smallFile, 1024);
  });

  bench("100 KB (buffered)", async () => {
    await hashFile(mediumFile, 100 * 1024);
  });

  bench("2 MB (streaming)", async () => {
    await hashFile(largeFile, 2 * 1024 * 1024);
  });
});

describe("computeContentHash", () => {
  bench("50 files (SHA-256 aggregate)", async () => {
    await computeContentHash(aggregateFiles, tempDir);
  });
});
