# CLAUDE.md

## Project

Knarr — Local npm package development without symlinks. Copies built files into consumer `node_modules/` with incremental sync and watch mode.

## Tech stack

- TypeScript (ESM, strict), Node.js >= 22.12
- Package manager: pnpm
- CLI: citty, picocolors, custom `consola` logger (`src/utils/console.ts`)
- File watching: chokidar v5
- File hashing: xxhash-wasm (per-file, incremental copy), SHA-256 (aggregate content hash)
- Build: tsup (bundles all deps)
- Tests: vitest

## Key concepts

- **Store** (`~/.knarr/store/`): mutable package cache, keyed by `name@version`
- **Publish**: copy built files (respecting `files` field) to the store
- **Inject**: copy from store into consumer's `node_modules/` (incremental, CoW)
- **Push**: publish + inject to all registered consumers
- **Tracker**: `.knarr/state.json` per consumer, `~/.knarr/consumers.json` globally
- `KNARR_HOME` env var overrides the store location (used in tests)

## Commands

```
pnpm build       # tsup build (three entries: CLI, API, Vite plugin)
pnpm test        # vitest run (requires example packages to be built)
pnpm lint        # tsc --noEmit
pnpm dev         # tsup --watch (builds Knarr itself, NOT the knarr dev CLI command)
pnpm bench       # vitest bench
```

## Testing

E2E tests use `examples/packages/` as real fixtures. They must be built first:
```
cd examples/packages/api-client && pnpm install && pnpm tsup
cd ../ui-kit && pnpm install && pnpm tsup
```

Tests redirect the store via `process.env.KNARR_HOME` to temp dirs. Coverage threshold: 70% lines (`vitest.config.ts`).

## Architecture

```
src/cli.ts           → citty entry point, global flags (--verbose, --dry-run, --json), interactive menu
src/commands/*.ts    → one file per CLI command (17 commands)
src/core/
  publisher.ts       → file resolution, hashing, atomic store write, lifecycle hooks, history capture
  injector.ts        → incremental copy from store to node_modules, backup/restore
  store.ts           → store CRUD, meta read/write
  tracker.ts         → consumer state (state.json) + global registry (consumers.json)
  push-engine.ts     → doPush() orchestrator, watch config resolution, multi-watch mode
  watcher.ts         → chokidar watcher with debounce + cooldown, build subprocess, bell notify
  watch-orchestrator.ts → cascading rebuild orchestrator for dev --all (reverse adjacency + state machine)
  batch-push.ts      → workspace batch push in topological order (push --all / dev --all)
  history.ts         → build history capture, list, restore, prune (knarr rollback)
src/utils/           → shared helpers
  fs.ts              → copyWithCoW, incrementalCopy, ensureDir
  hash.ts            → xxHash64 per-file, SHA-256 aggregate (computeContentHash)
  pack-list.ts       → resolvePackFiles (npm-pack-compatible file resolution)
  pm-detect.ts       → packageManager field + lockfile-based PM detection
  workspace.ts       → workspace root detection, catalog: parsing, workspace graph building, reverse adjacency
  topo-sort.ts       → Kahn's algorithm topological sort for workspace dependency ordering
  preflight.ts       → pre-flight validation (exports, types, entry points, bin paths)
  dry-run.ts         → mutation recorder and summary reporter for --dry-run mode
  bell.ts            → terminal bell notification (\x07 to stderr)
  lockfile.ts        → withFileLock (mkdir-based atomic lock, skipped in dry-run)
  concurrency.ts     → minimal pLimit reimplementation (two-pointer O(1) dequeue)
  bin-linker.ts      → create/remove node_modules/.bin entries
  bundler-detect.ts  → detect Vite, Webpack, etc.
  bundler-cache.ts   → invalidate bundler caches after injection
  vite-config.ts     → auto-inject/remove Knarr Vite plugin (balanced bracket parser, complexity detector)
  nextjs-config.ts   → auto-add transpilePackages for Next.js (wrapper function detection)
  tailwind-source.ts → auto-inject @source directive for Tailwind v4
  init-helpers.ts    → ensureGitignore, addPostinstall
  build-detect.ts    → auto-detect build command from package.json scripts
  output.ts          → structured JSON output (--json mode)
  logger.ts          → verbose() debug logging, flag init
  console.ts         → custom consola instance
  errors.ts          → errorWithSuggestion helper
  validators.ts      → input validation
  banner.ts          → CLI banner display
  paths.ts           → store/consumer path helpers
  timer.ts           → elapsed time tracker
src/vite-plugin.ts   → Vite plugin entry (exported as knarr/vite)
src/webpack-plugin.ts → Webpack/rspack plugin entry (exported as knarr/webpack)
src/index.ts         → programmatic API entry (exported as knarr)
src/types.ts         → shared interfaces
```

## Code style

- One `defineCommand()` per file in `src/commands/`, default-exported
- Utils are named exports, no default exports
- Use `consola` for user-facing messages, `verbose()` for debug-only logs
- Use `import type` for type-only imports
- Dynamic `import()` for heavy deps only loaded in some code paths (chokidar, vite-config)

## Gotchas

- `pnpm dev` (in the Commands section above) is `tsup --watch` for building Knarr itself — not the same as the `knarr dev` CLI command
- pnpm injects into `.pnpm/` virtual store by following symlinks — see `src/core/injector.ts`
- `workspace:*` and `catalog:` protocol versions are rewritten to real versions in the store copy (source untouched) — see `src/core/publisher.ts` and `src/utils/workspace.ts`
- Vite plugin watches `.knarr/state.json` and triggers server restart (new package) or full reload (existing package update) — not HMR
- Lifecycle hooks run in order: `preknarr` → `prepack` → [publish] → `postpack` → `postknarr`. Default timeout 30s (`KNARR_HOOK_TIMEOUT` env var)
- tsup has four build entries: CLI (bundled+minified, `noExternal: [/.*/]`), API lib (with .d.ts), Vite plugin (with .d.ts, vite external), Webpack plugin (with .d.ts, webpack external)
- Watch mode defaults: 500ms debounce, 500ms cooldown between builds
- `knarr clean` / `knarr gc` are aliases (same command registered twice in `src/cli.ts`)
- Build history: publisher captures old builds to `store/<pkg>/history/<buildId>/` before atomic swap; default limit 3, configurable via `package.json#knarr.historyLimit`
- `knarr push --all` / `knarr dev --all`: discovers workspace packages, topologically sorts by deps+devDeps, pushes/watches in dependency-first order
- `knarr dev --all` supports cascading rebuilds (default ON): when package A rebuilds, packages depending on A also rebuild. `--no-cascade` disables this. State machine (idle/building/queued) prevents infinite loops.
- Pre-flight checks run automatically on `knarr publish` (suppress with `--no-check`), also available standalone via `knarr check`
- `--dry-run` records all skipped mutations via `recordMutation()` in `src/utils/dry-run.ts`; commands print a grouped summary at exit
- Interactive CLI: running `knarr` with no subcommand in a TTY shows a select menu; non-TTY/CI shows banner only
- Webpack plugin (`knarr/webpack`): mirrors Vite plugin pattern — excludes linked packages from snapshot cache, watches state.json, invalidates compiler on changes
- Config rewriting uses balanced bracket scanner (handles nested `[]`, `()`, `{}`, strings, comments) and complexity detector (`isComplexConfig`) that gracefully falls back to manual instructions
