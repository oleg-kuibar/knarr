import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { availableParallelism } from "node:os";
import pLimit from "./concurrency.js";
import { verbose } from "./logger.js";
import { normalizePath } from "./paths.js";

import type xxhashInit from "xxhash-wasm";
type XXHashAPI = Awaited<ReturnType<typeof xxhashInit>>;

/** Lazy-initialized xxhash-wasm singleton (follows dynamic import pattern used elsewhere) */
let _xxhash: Promise<XXHashAPI> | null = null;
function getXXHash(): Promise<XXHashAPI> {
  if (!_xxhash) {
    _xxhash = import("xxhash-wasm")
      .then((mod) => mod.default())
      .catch((err) => {
        _xxhash = null;
        throw err;
      });
  }
  return _xxhash;
}

/** Files larger than this threshold use streaming hash */
const STREAM_THRESHOLD = 1024 * 1024; // 1MB

/** Concurrency limit for parallel file reads in computeContentHash */
const limit = pLimit(Math.max(availableParallelism(), 8));

// ── Per-file content cache for watch mode ──
// Avoids re-reading unchanged files on repeated computeContentHash calls.
// Keyed by absolute path; validated by mtime+size before reuse.
interface ContentCacheEntry {
  mtimeMs: number;
  size: number;
  content: Buffer;
}
const _contentCache = new Map<string, ContentCacheEntry>();

/**
 * Compute a SHA-256 content hash for a list of files.
 * The hash is deterministic: sorted by relative path, each entry is `path\0content`.
 * Reads files in parallel (up to CPU count concurrent) then feeds into hash in sorted order.
 *
 * In watch mode, unchanged files are served from an in-memory cache (validated
 * by mtime + size) so only modified files trigger actual disk reads.
 */
export async function computeContentHash(
  files: string[],
  baseDir: string
): Promise<string> {
  // Sort by relative path for determinism (normalize separators for cross-platform consistency)
  const sorted = [...files].sort((a, b) => {
    const relA = normalizePath(relative(baseDir, a));
    const relB = normalizePath(relative(baseDir, b));
    return relA.localeCompare(relB);
  });

  const currentFiles = new Set(sorted);
  let cacheHits = 0;

  // Stat + conditionally read files in parallel, maintaining sorted order
  const contents = await Promise.all(
    sorted.map((file) =>
      limit(async () => {
        const rel = normalizePath(relative(baseDir, file));
        const s = await stat(file);
        const cached = _contentCache.get(file);

        if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) {
          cacheHits++;
          return { rel, content: cached.content };
        }

        const content = await readFile(file);
        _contentCache.set(file, { mtimeMs: s.mtimeMs, size: s.size, content });
        return { rel, content };
      })
    )
  );

  // Evict stale entries for files no longer in the set
  for (const key of _contentCache.keys()) {
    if (!currentFiles.has(key)) _contentCache.delete(key);
  }

  verbose(`[hash] Computing content hash for ${files.length} files (${cacheHits} cached)`);

  // Use SHA-256 streaming for the aggregate content hash.
  // This is called once per publish (not per-file), and the deterministic
  // prefix "sha256v2:" is stored in metadata — switching to xxhash here would
  // invalidate every existing store entry for no meaningful speedup.
  const hash = createHash("sha256");
  const lenBuf = Buffer.alloc(4);
  for (const { rel, content } of contents) {
    hash.update(rel);
    hash.update("\0");
    // Length-prefix content to prevent ambiguity between consecutive entries
    // (without this, file A's content could blend into file B's path)
    lenBuf.writeUInt32LE(content.length);
    hash.update(lenBuf);
    hash.update(content);
  }

  const result = "sha256v2:" + hash.digest("hex");
  verbose(`[hash] Result: ${result.slice(0, 20)}...`);
  return result;
}

/**
 * Compute xxHash64 of a single file's content.
 * Used for per-file change detection during incremental copy — not persisted,
 * so no need for cryptographic strength. xxHash64 is ~5-10x faster than SHA-256.
 * - Files ≤1MB: buffered read + h64Raw
 * - Files >1MB: streaming via create64() hasher
 */
export async function hashFile(filePath: string, knownSize?: number): Promise<string> {
  const size = knownSize ?? (await stat(filePath)).size;
  const xx = await getXXHash();

  if (size > STREAM_THRESHOLD) {
    return hashFileStream(filePath, xx);
  }

  const content = await readFile(filePath);
  return xx.h64Raw(content).toString(16);
}

/**
 * Compute xxHash64 using streaming for large files.
 * Reads the file in 64KB chunks to avoid loading multi-MB files into memory.
 */
async function hashFileStream(filePath: string, xx: XXHashAPI): Promise<string> {
  const { createReadStream } = await import("node:fs");
  const hasher = xx.create64();
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => hasher.update(chunk));
    stream.on("end", () => resolve(hasher.digest().toString(16)));
    stream.on("error", reject);
  });
}
