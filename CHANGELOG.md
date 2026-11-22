# Changelog

## 0.3.0

Minor release (breaking for the programmatic API only). Fixes linked builds leaking into other projects through pnpm's hardlinks, changed files that never reached `node_modules`, and corrupt state files that wiped links or registrations.

### Breaking

- API: `ConsumerState.links` and `ConsumersRegistry` are `OwnRecord<…>` (branded null-prototype maps), so code that builds them from a `{}` literal no longer type-checks.
- API: `registerConsumer`, `unregisterConsumer`, and `cleanStaleConsumers` throw when `~/.knarr/consumers.json` is corrupt, instead of replacing it with an empty registry.

### Fixes

- **Injection no longer corrupts other projects through pnpm's hardlinks.** pnpm (and Bun) hardlink installed files to a global content-addressable store. Knarr overwrote those files in place, so a linked build also showed up in every other project using the same package version, and in the store itself, and `knarr remove` only restored the linked project. Knarr now writes each file to a temp file and renames it into place, which leaves the shared store files untouched. On Windows the rename retries for about a second while another process holds the file open. `pnpm store status` lists store packages that an earlier Knarr version modified.
- `list`, `clean`, `doctor`, `add`/`use`, and `update` no longer fail with `Invalid package version` while a publish holds its lock, and never pick up a publish's temp directory as a store entry. `clean` removes only the temp directories a publish creates (`<entry>.tmp-<pid>-<ms>` and `<entry>.old-<ms>`), takes their age from the timestamp in the name rather than the directory's modification time, and leaves those younger than 5 minutes alone, so it can't delete the files of a publish that is still running.
- A corrupt `~/.knarr/consumers.json` is no longer replaced with an empty registry, which dropped every registration and let `clean` delete store entries that linked projects still used. `add`/`use` and `remove` still link and unlink but leave the registry unchanged and warn how to recover, `clean` stops with that advice, and `doctor` fails its "Global registry" check. The exported `registerConsumer`, `unregisterConsumer`, and `cleanStaleConsumers` throw in that case instead of writing. Packages named like `Object.prototype` members (for example `constructor`) can be registered.
- A package named like an `Object.prototype` member (`constructor`, `toString`) no longer counts as linked in every project: `getLink()` and `knarr remove` saw a built-in function in `.knarr/state.json` where there was no link. The public `ConsumerState.links` and `ConsumersRegistry` types are now `OwnRecord<…>` (null-prototype maps), so a `{}` literal no longer type-checks as one.
- `dev`/`push --watch` with a build command no longer watches its own build output. A package that builds into `lib/` (listed in `files`, or as the directory of `main`, `module`, or `types`) kept rebuilding, because each build changed the files it watched. `src/` stays watched when `files` also publishes it as source. Set `package.json#knarr.watchPatterns` to override the watched paths.
- Injection compares the contents of same-size files instead of trusting a matching modification time. The first copy in `node_modules` comes from the package manager, and two builds of the same size written within one timestamp tick looked identical, so the new build never replaced the old one.
- Two Knarr processes injecting into the same package at once (for example `knarr dev` and the restore hook during an install) no longer delete each other's in-flight temp files, which failed the other run with `ENOENT`. Temp files left by processes that have exited are still removed.
- `knarr init`, and the setup that `add`/`use` run on a project, no longer wipe the links in a corrupt `.knarr/state.json`. They read it leniently, got no links, and wrote that back. They now stop with the same recovery advice as `add` and `remove`, and every write to the file holds its lock.
- `dev`/`push --watch` also skips build output that only `exports` points into, as it already did for `main`, `module`, and `types`.
- Publishing always reads file contents. An in-memory cache keyed by mtime and size skipped rebuilt files that kept their size and timestamp (common with coarse timestamps or tools that preserve mtime), so the change never reached consumers. Dropping it also lowers memory use in long `dev --all` sessions, which kept every published file in memory.

### Improvements

- Terminal colors use Node's built-in `util.styleText` instead of `picocolors`, so the CLI bundles one fewer dependency. Colors now follow the output stream: piped output and CI logs are plain unless `FORCE_COLOR` is set, including on Windows, where `picocolors` always colored. `NO_COLOR` still turns them off.

### Maintenance

- Every build now runs `publint` and `@arethetypeswrong/core` (ESM-only profile) against the packed tarball, and fails on any finding, so broken `exports` paths or unresolvable types can't be released.

## 0.2.0

### Breaking

- Require Node.js 22.22 or newer (was 22.12), the minimum for chokidar 6. `knarr doctor` now checks the minor version too.

### Fixes

- **Installs no longer silently drop linked packages.** After `npx knarr use` (the Quick Start path), every `npm install` removed the link with no message. The old `postinstall` hook needed `knarr` on PATH, and its `|| exit 0` hid the failure. The new hook runs a local, gitignored `.knarr/restore.cjs` that records the Knarr CLI that made the links. It works without a global install, does nothing for teammates without Knarr, and warns when it can't restore. The next `knarr use`/`add`, `knarr init`, or `knarr doctor --fix` upgrades existing hooks.
- **Version bumps no longer break the dev loop.** After the library bumped its version, pushes to pnpm, Yarn pnpm-linker, and Bun consumers failed with "target contains version 1.0.0". The consumer's own `node_modules/<pkg>` link is now checked by package name. Scanned virtual-store entries still must match the version. `push` also records the new version, so `status` stays accurate.
- **No more silent no-ops without a terminal.** In CI, scripts, or agents, commands showed a prompt they couldn't read and exited 0 having done nothing. Prompts with a safe default now take it and say so. Destructive confirmations exit 1 and ask for `--yes`, and `init` names `--role`.
- Windows: build commands and lifecycle scripts with quoted paths (for example `node "C:\Program Files\tool\build.js"`) work. Package-manager installs run by Knarr quote their arguments and no longer print Node's `DEP0190` warning.
- Windows: `knarr use`/`add` no longer fail with `EPERM` without symlink privilege when the installed package is an npm `file:` junction. Backups now recreate directory links as junctions.
- `knarr init --role library` writes `knarr:publish`/`knarr:dev` scripts that work without a global install (`npx --yes knarr …`, or plain `knarr` when it is a dependency).
- `dev`/`push --watch`: a failed rebuild says consumers keep the last pushed build, instead of the misleading "No successful push yet".
- pnpm/Yarn pnpm-linker: no fallback warning when linking a package that isn't installed yet. A declared-but-missing package warns once (it printed twice) and names the install command.
- Auto-configuring an empty Vite `defineConfig({})` produces a properly formatted config.
- Webpack/rspack plugin: no `add()` on a closing watcher.

### Improvements

- Secure-coding enforcement: `pnpm lint` now runs strict TypeScript over source and tests plus oxlint security rules, type-aware ones included. The rules ban `JSON.parse` outside `src/utils/json.ts`, `child_process` outside `src/utils/shell.ts`, `eval`, unsafe `any`, floating promises, and non-null assertions. Fixes found along the way:
  - Ctrl+C no longer hangs `dev`/`push --watch` when a watcher fails to close.
  - A failed Vite dev-server restart is logged instead of becoming an unhandled rejection that kills the dev server.
  - `pnpm-workspace.yaml` catalogs named `__proto__`, `constructor`, or `toString` no longer resolve to injected or built-in values.
  - A malformed scoped package name (`"@scope"`) no longer creates a bin called `undefined`.
  - Manifests whose `name` or `version` aren't strings are rejected before they reach store paths.

- Upgrade the file watcher to chokidar 6. It confirms events against the filesystem, fixes false `change` events on Windows and ignored paths on WSL, and stops dropping updates while throttling.
- Clearer next steps:
  - "Next" hints use short relative paths and say `npx knarr` when `knarr` isn't on PATH.
  - `use` on a workspace package suggests `knarr dev --all` from the workspace root.
  - `knarr publish` says when linked projects still have the previous build.
  - `use`/`add` point out when the linked package isn't in `package.json`, because `npm install <pkg>` skips `postinstall` and prunes it.
  - A failed pre-publish build suggests installing the library's dependencies or using `--skip-build`.
- `dev --all`: log lines name their package, and cascades say which dependents rebuild and why.
- Quieter output: the Vite plugin's watcher setup details need `knarr({ verbose: true })` or `KNARR_VERBOSE=1`, and the detected build command is logged once. `--dry-run` reports show short paths; `--json` keeps absolute paths.
- Examples: packages list `types` first in `exports` (they pass `knarr check`), and apps use the new restore hook.

### Maintenance

- Security: every lockfile is on the latest patch releases, using the same 7-day release-age policy, and `pnpm audit`, `npm audit`, and `bun audit` are clean. Examples require `vite ^6.4.5`; the old `^6.0.0` floor allowed versions with six known advisories (GHSA-587h-7wmj-h5pm is high severity). CI uses `actions/setup-node@v7`, and the publish job no longer restores a shared dependency cache, which removes a cache-poisoning risk for releases.
- Security hardening:
  - Every GitHub Action is pinned to a commit SHA. Workflows default to `permissions: {}` and drop checkout credentials, and zizmor (pedantic) lints them.
  - The publish workflow is split: a read-only job builds, tests, and packs; an isolated OIDC job publishes the hash-verified tarball with provenance and blocked network egress.
  - New checks: dependency review on PRs (any severity, license allowlist), an all-severity audit of every lockfile, a tarball file allowlist, and OpenSSF Scorecard.
  - pnpm settings: `minimumReleaseAgeStrict`, `trustPolicy: no-downgrade`, no dependency install scripts, `blockExoticSubdeps`, `engineStrict`.
  - Dependabot also covers the example lockfiles. Added CODEOWNERS, a tighter `SECURITY.md`, and stricter Claude Code permissions.
- Toolchain: native and Rust-based. TypeScript 7 type-checks, tsdown (Rolldown) bundles with Oxc isolated declarations for the public `.d.ts`, and oxlint with tsgolint replaces ESLint and typescript-eslint. The public types and the bundled CLI are unchanged. Also pnpm 12, Vitest 5 (benchmarks ported to the test-context `bench` API), Vite 8.3, and Node 26 in the CI matrix. The example library fixtures use tsup 9 with TypeScript 6 (tsup's `.d.ts` build needs TypeScript's JS compiler API); the example apps use TypeScript 7. `pnpm audit` is clean.
- Agent setup for Claude Code (`CLAUDE.md` imports `AGENTS.md`, the single source of guidance; `.claude/agents`, `.claude/skills`, `.claude/settings.json`) and refreshed Codex agents.

## 0.1.3

- Centralize package-manager discovery, compatibility, installation layout, and command behavior behind npm, pnpm, Yarn, and Bun adapters.
- Keep tracked package-manager fallback, Yarn linker diagnostics, and virtual-store resolution consistent across add, init, doctor, update, restore, publish, inject, and push workflows.
- Expand adapter-level coverage for node_modules, pnpm, Yarn pnpm-linker, Yarn PnP, and Bun layouts.

## 0.1.2

- Fix watch mode on WSL Windows-mounted paths by enabling polling where native filesystem events are unreliable.

## 0.1.1

- Clarify README, FAQ, comparison, and yalc migration docs around native package-manager workflows, yalc, and Knarr tradeoffs.
- Recommend canary or prerelease packages for CI and release validation, with Knarr limited to local smoke tests.

## 0.1.0

- Expand package-manager support for Yarn Berry node-modules, Yarn pnpm-linker, Yarn PnP rejection, pnpm virtual stores, and Bun install layouts.
- Run Yarn PnP lifecycle hooks through Yarn and preserve package-manager layout metadata across restore, update, and push.
- Harden injection, doctor, and explain diagnostics against stale or external virtual-store targets.
- Improve publish output for `publishConfig.directory`, workspace aliases, catalog dependencies, `.gitignore` packing, and unchanged rewritten manifests.
- Make watch and dry-run workflows safer, including initial build handling, dry-run watch exits, dependency-aware workspace skips, and cascade failure handling.
- Add compatibility smoke coverage and package-manager-focused regression tests.

## 0.0.3

- Keep auto-installed setup dependencies from pruning freshly linked packages.
- Expose plugin entry points to CommonJS config files used by Webpack and rspack.

## 0.0.2

- Validate package names and versions before deriving store or consumer paths.
- Honor dry-run mode for setup, migration, copy, and install mutations.
- Preserve live store entries when publish or rollback swaps fail.
- Reuse resolved build commands for cascading workspace rebuilds.
- Fix generated Windows `.cmd` bin wrappers to invoke Node.

## 0.0.1

- Initial Knarr release.
