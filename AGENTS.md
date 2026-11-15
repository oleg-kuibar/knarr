# AGENTS.md

Knarr is a CLI and library for local npm package development without symlinks. It copies a package's publishable files into consumers' `node_modules/`, syncs them incrementally, and has a watch mode.

This file is the shared source of truth for coding agents (Codex reads it directly; Claude Code through the one-line `CLAUDE.md` import). Keep it short and factual. Put procedures in `.claude/skills/`, not here.

## Setup

- Node.js >= 22.22 (`package.json#engines`). pnpm 12 is pinned in `packageManager`.
- Node 25+ no longer bundles corepack. Use `npm i -g corepack && corepack enable`, or run pnpm as `npx pnpm@12.18.0 <cmd>`.
- First run: `pnpm install`, then build the e2e fixtures (they use npm, not pnpm):
  ```
  cd examples/packages/api-client && npm ci && npx tsup
  cd ../ui-kit && npm ci && npx tsup
  ```

## Commands

```
pnpm lint                                   # strict tsc (TypeScript 7) over src + tests, then oxlint secure-coding rules
pnpm lint:fix                               # auto-fix what oxlint can
pnpm build                                  # tsdown: CLI, API, Vite plugin, Webpack plugin; then publint + attw on the packed tarball
pnpm test                                   # vitest run (needs the fixtures above)
pnpm vitest run src/__tests__/watcher.test.ts      # one file
pnpm vitest run -t "pnpm injection > honors"        # by name; vitest 5 joins suite > test with ">"
pnpm bench                                  # vitest bench (Vitest 5 API: test(..., ({ bench }) => ...))
pnpm compat:smoke                           # real npm/pnpm/Yarn 4/Bun/Vite/Webpack/rspack/Next consumers
pnpm dev                                    # tsdown --watch for Knarr itself, NOT `knarr dev`
```

Before calling work done: `pnpm lint && pnpm build && pnpm test`. Run `pnpm compat:smoke` (after `pnpm build`) when injection, package-manager layout, or bundler code changes.

## Key concepts

- **Store** `~/.knarr/store/<name>@<version>/`: mutable package cache. `KNARR_HOME` overrides the root (tests always set it).
- **Publish**: resolve files like `npm pack` (`files`, `.npmignore`/`.gitignore`), hash, and atomically swap into the store. Old builds go to `history/` (default limit 3).
- **Inject**: incremental copy (xxhash per file, CoW where available) from store into the consumer's real package dir.
- **Push**: publish, then inject into every registered consumer. `--all` runs in workspace topological order.
- **Tracker**: per-consumer `.knarr/state.json`, global `~/.knarr/consumers.json`.

## Code map

```
src/cli.ts                 citty entry, global flags (--verbose, --dry-run, --json), TTY menu
src/commands/*.ts          one defineCommand() per file, default export; 18 commands (+ gc alias of clean)
                           add-flow.ts is shared add/use logic, not a command
src/core/publisher.ts      file resolution, hashing, lifecycle hooks, atomic store swap, history capture
src/core/injector.ts       incremental copy, pnpm/Yarn/Bun virtual-store targets, backup/restore
src/core/store.ts, tracker.ts, history.ts
src/core/push-engine.ts    doPush(), watch config resolution
src/core/batch-push.ts     push --all; watch-orchestrator.ts is the cascading rebuild state machine
src/core/watcher.ts        chokidar 6 watcher, debounce/cooldown, build subprocess
src/utils/package-manager.ts  PM adapters (layout, compatibility, commands); pm-detect.ts = raw probes
src/utils/workspace.ts     workspace root (walks up to pnpm-workspace.yaml), catalog:, graph
src/utils/vite-config.ts, nextjs-config.ts, tailwind-source.ts   consumer config rewriters
src/utils/shell.ts         spawnShell() for command lines, spawnCommand() for executable + args
src/index.ts               public API (`knarr`); vite-plugin.ts (`knarr/vite`); webpack-plugin.ts (`knarr/webpack`)
```

## Rules for changes

- **Commands**: `--json` output goes through `output()` in `src/utils/output.ts`. Nothing else may write to stdout in JSON mode. Diagnostics go to `consola`/`verbose()`.
- **Dry run**: every mutation must check `isDryRun()` and call `recordMutation()` instead of touching disk.
- **Child processes**: run user command lines (build commands, hooks) with `spawnShell()`, and an executable plus arguments (package-manager installs) with `spawnCommand()`. Never hand-build `cmd /c` or pass an args array with `shell: true`: Windows quoting breaks on paths with spaces, and Node warns with DEP0190.
- **Paths**: never assume `/`. Use `node:path` joins, and use `normalizePath()` only for comparison or storage.
- **Filesystem scope**: write only inside the store (`KNARR_HOME`), the consumer's `.knarr/`, and the resolved package target. Follow pnpm `.pnpm/` and Yarn `.store/` symlinks to the real dir; never replace the top-level symlink.
- **Public surface**: a new flag, command, export, env var, or `package.json#knarr` field needs tests plus docs in `docs/commands.md` or `docs/api.md`, and a `CHANGELOG.md` "Unreleased" entry.
- **Terminal colors**: use `pc` from `src/utils/colors.ts` (Node's `util.styleText`); don't add a color library.
- **Style**: strict ESM TypeScript, `import type` for types, named exports in utils, dynamic `import()` for heavy optional deps (chokidar, config rewriters).

## Testing notes

- Tests isolate the store with `process.env.KNARR_HOME` set to a temp dir and clean up in `afterEach`.
- Tests that create symlinks use `it.skipIf(!canCreateSymlinks)` from `src/__tests__/helpers/symlinks.ts`. On Windows without Developer Mode they are reported as skipped, not failed; CI runs them.
- `src/__tests__/watcher.test.ts` exercises real chokidar. Keep it when you touch watcher options.
- Coverage threshold: 70% lines (`vitest.config.ts`).

## Secure coding

Knarr reads files written by other people (a linked library's `package.json` and build output, consumer manifests, `pnpm-workspace.yaml`, lockfiles, state from older versions) and writes into their projects. Treat all of it as untrusted. `pnpm lint` enforces most of these rules (strict `tsconfig.json` flags plus `.oxlintrc.json`, whose type-aware rules run on tsgolint), and the Claude Code edit hook runs oxlint on every edited file.

- **Untrusted JSON**: never call `JSON.parse`. Use `parseJson`, `parseJsonObject` or `readJsonObject` from `src/utils/json.ts` and narrow the result with `stringField`, `objectField`, `stringRecordField` or `asPackageJson`. No `any` (`no-explicit-any`, `no-unsafe-*`), and no `as SomeType` on unvalidated data.
- **Objects keyed by untrusted strings**: use a `Map` or `Object.create(null)`, never `{}`. A `__proto__` key would replace the object's prototype, and keys like `constructor` resolve to built-ins.
- **Paths**: run `validatePackageIdentity()` on names and versions before building store or `node_modules` paths from them. Before following a symlink or deleting, check that the resolved path stays inside the allowed root (see `isPathInside` in `src/core/injector.ts`).
- **Processes**: only `src/utils/shell.ts` may import `child_process` (lint-enforced). `spawnShell()` is only for command lines the user configured (build commands, lifecycle hooks). Everything else uses `spawnCommand(executable, args)`; never splice untrusted values into a command string.
- **Code execution**: no `eval`, `new Function`, string timers, or `Math.random()` for anything security-relevant (use `node:crypto`).
- **Async**: no floating or misused promises. A callback in a timer, signal handler, or event listener must handle its own errors. A shutdown handler must always resolve, even when `close()` fails.
- **Indexing**: `noUncheckedIndexedAccess` is on. Handle the `undefined` case (destructure, `entries()`, `?? fallback`) instead of using `!`, which is lint-banned in `src/`.
- **Errors**: rethrow with `{ cause }`. Never log environment variables, tokens, or file contents that might hold secrets.
- **Suppressions**: `oxlint-disable-next-line <rule> -- <why>` needs the reason, and unused disables fail lint.
- **Tests**: every security fix gets a regression test that fails on the old code.

## Security rules

These are enforced in CI (zizmor, dependency review, audit, verify-pack). Don't weaken them without a comment explaining why. See `SECURITY.md`.

- **Workflows**: `permissions: {}` at the top, with per-job permissions that each carry a comment. Pin actions to a full commit SHA with a `# vX.Y.Z` comment. Use `persist-credentials: false` on checkout and no dependency cache in the release pipeline. Before pushing, run `zizmor --persona pedantic .github/workflows`; it must report no findings.
- **Publishing**: only `publish.yml`. Its `publish` job holds OIDC and must stay free of checkout, installs, and repo scripts. Never publish locally.
- **Dependencies**: no dependency may run install scripts (`allowBuilds` in `pnpm-workspace.yaml`; `--ignore-scripts` for npm fixtures). New dependencies need a license from the dependency-review allowlist and must pass `pnpm audit --audit-level=low`.
- **Package contents**: `scripts/verify-pack.mjs` allowlists the tarball. Widen it deliberately, never to make CI pass. `pnpm build` also runs publint and attw (`tsdown.config.ts`) and fails on any finding; don't lower their level to get a build through.

## Dependencies

- The CLI bundles every runtime dependency (`noExternal`). A dependency's `engines.node` therefore becomes Knarr's. Check it before bumping (chokidar 6 is why the floor is 22.22).
- Toolchain is native: TypeScript 7 (`tsc` type-checks only), tsdown (Rolldown) bundles, Oxc writes the public `.d.ts`, oxlint + tsgolint lint. Nothing here needs TypeScript's old JS compiler API, so stay off tools that do (tsup's `.d.ts` build, typescript-eslint).
- Public declarations use Oxc isolated declarations: `tsconfig.dts.json` checks the public entry graph with `isolatedDeclarations`, so exported functions and objects there need explicit types.
- pnpm settings live in `pnpm-workspace.yaml` (pnpm 11+ ignores `package.json#pnpm`). The file has no `packages:` list, and `minimumReleaseAge` enforces a 7-day cooldown on new versions.
- `src/utils/workspace.ts` walks up to the nearest `pnpm-workspace.yaml`. That includes the repo root's file when Knarr runs inside `examples/`.

## Gotchas

- Restore hook: the committed `postinstall` runs the gitignored `.knarr/restore.cjs`, which `ensureRestoreHook()` regenerates on every link with the running CLI's path. It must stay a no-op without `.knarr/` and never fail an install. `knarr restore` runs inside installs, so it may rewrite only that script, never `package.json`.
- Prompts: without a TTY, `consola.prompt` answers from an explicit `initial`/`default` and otherwise exits 1 with a hint. Give destructive confirms no `initial`, and add a `--yes`-style flag for each new prompt.
- Injection identity: a target reached through the consumer's own `node_modules/<pkg>` link is checked by name only, because version bumps mid-development are normal. Virtual-store scan candidates must match name and version.
- Lifecycle order: `preknarr` → `prepack` → publish → `postpack` → `postknarr`. Timeout 30s (`KNARR_HOOK_TIMEOUT`).
- `workspace:` and `catalog:` versions are rewritten in the store copy only; the source is untouched.
- The Vite plugin watches `.knarr/state.json`: new package → server restart, update → full reload (not HMR). The Webpack plugin mirrors this.
- `src/vite-plugin.ts` configures Vite's own bundled watcher; its `usePolling` options are Vite's, not chokidar 6's.
- Watch defaults: 500ms debounce, 500ms cooldown. `dev --all` cascades rebuilds by default (`--no-cascade`), with an idle/building/queued state machine to prevent loops.
- Config rewriters use a balanced-bracket scanner plus `isComplexConfig()`. When unsure, they print manual instructions rather than rewrite.

## Review guidelines

Reviews should flag P0/P1 risks, not style:

- Store, publish, inject, push, watch, rollback, and workspace changes: data loss, stale state, writes outside the intended roots, broken dry-run.
- File operations: `KNARR_HOME` isolation, PM layouts (pnpm virtual store, Yarn pnpm-linker, Bun), bin links, hook order, Windows paths and junctions.
- Watch and cascade: debounce/cooldown, races, child-process cleanup, infinite rebuild loops.
- Config rewriting: nested brackets, strings and comments, complex-config fallback.
- Public CLI/API changes: tests and docs updated; `--json` stdout stays machine-readable.
- Prefer focused tests near the change. Add integration or e2e tests when a change crosses publisher, injector, tracker, watcher, or workspace boundaries.

## Agent tooling

- Codex: agents in `.codex/agents/` (`knarr_pr_mapper`, `knarr_reviewer`, `knarr_docs_checker`), config in `.codex/config.toml` (keep `max_depth = 1`). Request a GitHub review with `@codex review`.
- When you update a rule here, check whether an agent prompt repeats it.

### Claude Code

`CLAUDE.md` only imports this file (`@AGENTS.md`, as the Claude Code memory docs recommend for repos that use `AGENTS.md`; a symlink doesn't survive a Windows checkout). Put Claude-specific guidance here, not in `CLAUDE.md`.

- Permissions and hooks: `.claude/settings.json`. A `PostToolUse` hook (`.claude/hooks/lint-edited-file.mjs`) lints every edited file against the secure-coding rules. When it reports errors, fix them before moving on; don't add an `oxlint-disable` to get past it.
- After code changes, run the `verify` skill (lint, build, test, plus compat smoke when injection or PM code changed) before reporting done. Report skipped symlink tests as skips, not passes.
- Subagents in `.claude/agents/` for isolated work:
  - `knarr-reviewer`: correctness and data-safety review of a diff (read-only).
  - `knarr-docs-checker`: docs, CLI help, and changelog drift for a diff (read-only).
  - `knarr-test-triager`: run tests and diagnose failures without filling the main context with logs.
- Skills in `.claude/skills/`: `/knarr-review` runs the reviewer and docs checker in parallel against `master` and merges their findings; `/verify` is the local gate. `/upgrade-deps` and `/release` are user-invoked procedures. Don't start them unprompted.
- Personal notes go in `CLAUDE.local.md` (gitignored). Its presence doesn't matter here, because `CLAUDE.md` imports this file explicitly.
