import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { availableParallelism } from "node:os";
import pLimit from "./concurrency.js";
import { verbose } from "./logger.js";
import { normalizePath } from "./paths.js";

/** Concurrency limit for parallel file reads in computeContentHash */
const limit = pLimit(Math.max(availableParallelism(), 8));

/**
 * Compute a SHA-256 content hash for a list of files.
 * The hash is deterministic: sorted by relative path, each entry is `path\0content`.
 * Reads files in parallel (up to CPU count concurrent) then feeds into hash in sorted order.
 */
export async function computeContentHash(
  files: string[],
  baseDir: string,
  contentOverrides: Map<string, string | Buffer> = new Map()
): Promise<string> {
  // Sort by relative path for determinism (normalize separators for cross-platform consistency).
  // Content overrides are hash inputs even when the generated file is not present
  // in the physical file list.
  const fileByRel = new Map(
    files.map((file) => [normalizePath(relative(baseDir, file)), file])
  );
  for (const rel of contentOverrides.keys()) {
    if (!fileByRel.has(rel)) fileByRel.set(rel, join(baseDir, rel));
  }
  const sorted = [...fileByRel.entries()].sort(([relA], [relB]) =>
    relA.localeCompare(relB)
  );

  const contents = await Promise.all(
    sorted.map(([rel, file]) =>
      limit(async () => {
        const override = contentOverrides.get(rel);
        if (override !== undefined) {
          return {
            rel,
            content: Buffer.isBuffer(override) ? override : Buffer.from(override),
          };
        }
        return { rel, content: await readFile(file) };
      })
    )
  );

  verbose(`[hash] Computing content hash for ${sorted.length} files`);

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
