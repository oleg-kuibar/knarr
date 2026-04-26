# Knarr v1 Analysis: Architecture, Performance, and Roadmap

Deep analysis of Knarr's internals, algorithmic complexity, code quality, and competitive positioning. Covers architecture improvements, performance bottlenecks, missing features, and a prioritized roadmap to v1.

---

## Table of Contents

1. [Algorithmic Complexity & Performance](#1-algorithmic-complexity--performance)
2. [Code Quality & Correctness Issues](#2-code-quality--correctness-issues)
3. [Missing Features & Competitive Gaps](#3-missing-features--competitive-gaps)
4. [v1 Roadmap](#4-v1-roadmap)

---

## 1. Algorithmic Complexity & Performance

### 1.1 `incrementalCopy` (`src/utils/fs.ts`)

The core sync engine uses a three-tier skip heuristic per file:
1. **Size differs** → copy immediately (2 stat calls, no hash)
2. **Size + mtime match** → skip (Knarr is the sole writer, so same mtime = same content)
3. **Size matches, mtime differs** → xxHash64 both files, compare

| Operation | Complexity |
|---|---|
| Source directory walk | O(S) via single `readdir({ recursive: true })` syscall |
| Per-file stat | O(S) parallel via `ioLimit` |
| Per-file hash (fallthrough) | O(S × F) where F = avg file size |
| Dest directory walk | O(D) — second full walk |
| Dest orphan detection | O(1) per file via `Set.has` |

**Bottleneck: Double directory walk.** `collectFiles(srcDir)` runs first, then after all copies complete, `collectFiles(destDir)` runs again for orphan detection. Both could run in parallel at the start:

```typescript
const [srcFiles, destFiles] = await Promise.all([
  collectFiles(srcDir),
  collectFiles(destDir),
]);
```

**Impact:** Low for typical packages (50-200 files). Noticeable for large component libraries (1000+ files).

The **mtime fast-path is the key optimization** — after the first sync, the `utimes` call copies source mtime to dest. All subsequent runs with no changes skip entirely: zero hashing, zero reads.

### 1.2 `pLimit` Queue (`src/utils/concurrency.ts`)

The minimal pLimit reimplementation uses `Array.shift()` for dequeue — O(n) per call, O(n²/concurrency) amortized across a full batch.

For 50 files at concurrency 8: ~882 element moves (negligible).
For 500 files: ~123,000 element moves (microseconds, still negligible).

**Fix:** Two-pointer approach gives O(1) dequeue:
```typescript
let head = 0;
const next = () => {
  if (head < queue.length && active < concurrency) {
    active++;
    queue[head++]();
  }
};
```

### 1.3 Content Hashing (`src/utils/hash.ts`)

- Files ≤ 1MB: loaded entirely into memory, passed to `xx.h64Raw()`
- Files > 1MB: streamed in 64KB chunks

Peak memory: `ioLimit` (typically 8) concurrent files × 1MB = ~8MB. Acceptable for dev tooling.

**Module-level cache (`_contentCache`)** persists across watch-mode cycles — unchanged files aren't re-read from disk. Cache eviction removes files no longer in the current set. Correct but never shrinks across different packages if multiple are published in one process.

### 1.4 File Resolution (`src/utils/pack-list.ts`)

`collectAllFiles` uses recursive sequential `readdir` with `results.push(...array)` spread at each level. The spread is O(n) per level and creates intermediate array copies.

**Fix:** Pass results array by reference and parallelize subdirectory reads:
```typescript
async function collectAllFiles(dir, rootDir, results = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  const subdirs = [];
  for (const entry of entries) {
    if (entry.isDirectory()) subdirs.push(join(dir, entry.name));
    else results.push(join(dir, entry.name));
  }
  await Promise.all(subdirs.map(d => collectAllFiles(d, rootDir, results)));
  return results;
}
```

### 1.5 File Locking (`src/utils/lockfile.ts`)

Uses `mkdir` as an atomic primitive (OS guarantees single creator). Stale detection via mtime comparison.

**Issue:** Default stale threshold is 10 seconds — too short for tracker locks when filesystems are slow. Publisher correctly overrides to 60s, but `tracker.ts` calls (`addLink`, `removeLink`, `registerConsumer`) use the default.

**TOCTOU race:** If process A removes a stale lock while process B (the legitimate holder) is still running, B's `finally` cleanup may clear A's newly acquired lock. The window is narrow (requires 10s+ stale threshold to fire while holder is alive but slow) but real.

**Fix:** Write `process.pid` inside the lock directory. On stale check, verify the PID is still alive via `process.kill(pid, 0)`.

### 1.6 Watcher Cooldown (`src/core/watcher.ts`)

The `hasPendingChanges` flag correctly coalesces events during an active build. However, the cooldown guard in `doBuild()` checks `Date.now() - lastBuildEndTime < cooldownMs`. A timer set for exactly `cooldownMs` could fire 1ms early due to timer precision, causing `doBuild()` to silently return and drop pending changes.

**Fix:** Add +1ms buffer to the timer delay.

### Summary: Performance

| Component | Issue | Severity | Fix Effort |
|---|---|---|---|
| `incrementalCopy` double walk | Sequential src→dest walks | Low | Low |
| `pLimit` shift() | O(n) dequeue | Low | Low |
| `collectAllFiles` spread | O(n) per level, sequential recursion | Low-Med | Low |
| Lockfile stale threshold | 10s default too short for tracker | Low | Trivial |
| Lockfile TOCTOU | Stale eviction race | Medium | Medium |
| Watcher cooldown | Timer precision edge case | Low | Trivial |
| Publisher orphan `.old-` dirs | Not cleaned on crash | Low | Low |

---

## 2. Code Quality & Correctness Issues

### 2.1 `--dry-run` Is Mostly Broken

Declared as a global flag in `src/cli.ts:43-47`. Only checked in `src/utils/fs.ts`:
- `copyWithCoW` — skips copy ✓
- `removeDir` — skips removal ✓
- `atomicWriteFile` — skips write ✓

**NOT gated:**
- `ensureDir` / `ensurePrivateDir` — directories created in dry-run
- `moveDir` — atomic rename executes
- Publisher: lock acquisition, `rename(storeEntryDir, oldDir)` all execute
- Injector: `createBinLinks`, `invalidateBundlerCache` execute
- Tracker: `state.json` and `consumers.json` writes execute
- No command prints a "what would happen" summary

**Severity: High.** The flag is misleadingly named — it provides partial protection at the I/O layer but all metadata operations (state, registry, locks, bin links) run normally.

### 2.2 Missing Confirmation Prompts

| Command | Issue |
|---|---|
| `knarr remove --all` | Deletes all linked packages without confirmation |
| `knarr clean` / `knarr gc` | Deletes store entries and temps without confirmation |
| `knarr migrate` | Rewrites `package.json`, deletes `.yalc/` and `yalc.lock` without confirmation |

### 2.3 Config Rewriting Fragility

**Vite config (`src/utils/vite-config.ts:82`):**
```typescript
const pluginsRegex = /plugins\s*:\s*\[([\s\S]*?)\]/;
```
The lazy `*?` stops at the first `]`. Any plugin with array arguments (e.g., `rollupOptions({ output: [{ ... }] })`) causes premature termination.

The import insertion regex `/^import\s.+$/gm` doesn't handle multi-line imports:
```typescript
import {
  something,
  another
} from "vite";
```

**Next.js config (`src/utils/nextjs-config.ts:71`):**
Misses common patterns: `withNextra()` wrappers, `defineConfig()`, composed plugins like `withMDX(withBundleAnalyzer({...}))`.

### 2.4 Package Manager Detection Ignores `packageManager` Field

`src/utils/pm-detect.ts` only checks lockfile presence. Modern projects declare `"packageManager": "pnpm@9.0.0"` in `package.json` (the canonical source recommended by Node.js Corepack). A project with `"packageManager": "bun@1.0.0"` but a stale `pnpm-lock.yaml` would be mis-detected.

### 2.5 Windows `.ps1` Wrappers Missing

`src/utils/bin-linker.ts:61-71` creates `.cmd` and shell wrappers but not `.ps1`. PowerShell users running `binName` directly (not via npm scripts) will get "not recognized" errors. npm creates all three.

### 2.6 No Central Path Normalization

The pattern `path.replace(/\\/g, "/")` appears ad-hoc in at least 4 files:
- `src/core/injector.ts:198`
- `src/core/clean.ts:64`
- `src/utils/tailwind-source.ts:25`
- `src/utils/bin-linker.ts:56`

No shared `normalizePath()` utility exists.

### 2.7 Module-Level Cache Races

`src/core/publisher.ts` has three module-level caches (`_cachedWorkspaceRoot`, `_cachedWorkspaceVersions`, `_cachedCatalogs`) that are read/written without synchronization. In `knarr publish --recursive`, concurrent `publish()` calls race to write these caches.

The workspace root cache only stores one entry — concurrent publishes for different packages evict each other. Not incorrect (just re-fetches) but wasteful.

### 2.8 Other Command Issues

| Issue | Location |
|---|---|
| `dev` command has no `--force` flag (inconsistent with `push`) | `src/commands/dev.ts:40` |
| `update` silently upgrades to latest store version, no version mismatch warning | `src/commands/update.ts:60` |
| `init` uses `JSON.parse`/`JSON.stringify` on `package.json`, drops comments | `src/commands/init.ts:259-269` |
| Bundler detection is sequential (12 stat calls) | `src/utils/bundler-detect.ts:25-34` |
| Tailwind scan does full recursive `readdir` before filtering | `src/utils/tailwind-source.ts:16-18` |

---

## 3. Missing Features & Competitive Gaps

### vs. yalc (primary competitor)

Knarr already wins: incremental xxhash copy, built-in watch+build, pnpm support, Vite plugin, CoW reflinks, doctor, JSON output, backup/restore.

Critical yalc pain points Knarr can exploit:
- [No recursive dependency resolution](https://github.com/wclr/yalc/issues/95) (17+ upvotes)
- [Not working for rapid development](https://github.com/wclr/yalc/issues/195)
- [No monorepo batch support](https://github.com/wclr/yalc/issues/197)

### vs. npm/pnpm link

Knarr already wins: no symlink issues, no duplicate React, no module resolution breakage.

Knarr loses: `npm link` is zero-setup (no publish step needed).

### vs. Turborepo/Nx

Complementary, not competitive — but dependency graph awareness would make Knarr viable for monorepo users who don't want a full build orchestrator.

### Feature Gap Analysis

#### Tier 1: Table-Stakes for v1

| # | Feature | Description | Effort |
|---|---|---|---|
| 1 | **Multi-package batch ops** | `knarr push --all` / `knarr dev --all` with topological ordering | Medium |
| 2 | **Clean teardown** | `knarr restore --all` restores everything to npm-installed state | Low |
| 3 | **Configuration file** | `package.json#knarr` field for persisting watch/build/consumer config | Medium |
| 4 | **Store disk reporting** | Show per-entry size in `list --store`, report reclaimed bytes in `clean` | Low |

#### Tier 2: High-Value Differentiators

| # | Feature | Description | Effort |
|---|---|---|---|
| 5 | **Build history + rollback** | Keep last N builds, `knarr rollback <package>` | Medium |
| 6 | **Dependency graph** | Cascade rebuilds when an upstream package changes | High |
| 7 | **Webpack/Turbopack plugin** | Parity with Vite plugin for cache invalidation | Medium |
| 8 | **Interactive CLI** | `knarr` (no subcommand) launches guided workflow | Low |
| 9 | **Notifications** | Terminal bell / desktop notification on push complete | Low |
| 10 | **Pre-flight validation** | Warn on missing `exports`/`types`/`main` before publish | Low |

#### Tier 3: Post-v1

| # | Feature | Description | Effort |
|---|---|---|---|
| 11 | Patch mode | `knarr patch <pkg>` for temporary fixes to deps | High |
| 12 | Local registry | `knarr serve` as lightweight npm registry | Very High |
| 13 | Affected detection | Only push packages whose source files changed | Medium |

---

## 4. v1 Roadmap

### v0.8: Foundation

**Code quality fixes:**
- [ ] Fix `--dry-run` to gate all state writes (tracker, registry, bin links, bundler cache) and print "what would happen" summaries
- [ ] Add confirmation prompts for `remove --all`, `clean`, and `migrate`
- [ ] Add `--force` flag to `dev` command (parity with `push`)
- [ ] Add version mismatch warning to `update` command
- [ ] Check `packageManager` field in `package.json` for PM detection
- [ ] Create `.ps1` wrappers on Windows in bin-linker
- [ ] Extract `normalizePath()` utility, replace ad-hoc replacements

**Performance:**
- [ ] Parallelize double directory walk in `incrementalCopy`
- [ ] Use two-pointer queue in pLimit
- [ ] Increase default stale threshold for tracker locks
- [ ] Fix watcher cooldown timer precision edge case
- [ ] Clean up orphaned `.old-*` directories in publisher

**Features:**
- [ ] Configuration file support (`package.json#knarr`)
- [ ] `knarr restore --all` for clean teardown
- [ ] Store disk usage reporting in `list --store` and `clean`

### v0.9: Workspace

- [ ] `knarr push --all` / `knarr dev --all` with workspace package discovery
- [ ] Topological ordering for multi-package publish
- [ ] Build history with `knarr rollback`
- [ ] Pre-flight validation in `knarr publish` (warn on missing exports/types)
- [ ] Terminal bell notification in watch mode

### v1.0: Stable

- [ ] Dependency graph awareness for cascading rebuilds in `dev --all`
- [ ] Webpack plugin (parity with Vite plugin)
- [ ] Interactive CLI mode (`knarr` with no subcommand)
- [ ] Comprehensive `--dry-run` support across all commands
- [ ] Robust config rewriting (AST-based or fallback to manual instructions)

### Post-v1

- Patch mode (`knarr patch`)
- Local registry (`knarr serve`)
- Affected-only detection
- Desktop notifications via node-notifier
- Turborepo/esbuild plugins

---

## Appendix: Key Source Files

```
src/cli.ts                  → Entry point, 13 commands, global flags
src/core/publisher.ts       → File resolution, hashing, atomic store write, hooks
src/core/injector.ts        → Incremental copy, pnpm .pnpm/ resolution, backup
src/core/push-engine.ts     → doPush() orchestrator
src/core/watcher.ts         → chokidar watcher, debounce + cooldown
src/core/store.ts           → Store CRUD
src/core/tracker.ts         → Consumer state + global registry
src/utils/fs.ts             → copyWithCoW, incrementalCopy, dry-run gates
src/utils/hash.ts           → xxHash64 per-file, SHA-256 aggregate
src/utils/pack-list.ts      → npm-pack-compatible file resolution
src/utils/concurrency.ts    → pLimit reimplementation
src/utils/lockfile.ts       → mkdir-based atomic file lock
src/utils/pm-detect.ts      → Lockfile-based PM detection
src/utils/bin-linker.ts     → .bin/ entry creation (Windows gaps)
src/utils/vite-config.ts    → Regex-based Vite config rewriting
src/utils/nextjs-config.ts  → Regex-based Next.js config rewriting
src/utils/tailwind-source.ts → Tailwind @source directive injection
src/utils/bundler-detect.ts → Sequential bundler detection
```
