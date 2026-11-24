---
name: upgrade-deps
description: Upgrade Knarr's dependencies and toolchain safely (outdated check, audit, majors with release-note review, engines impact, lockfile regeneration, verification). Use when asked to update dependencies, fix audit alerts, or bring the repo up to date.
disable-model-invocation: true
---

## 1. Survey (read-only)

- `pnpm outdated`, `pnpm audit`, `npm view pnpm dist-tags`.
- For each candidate, get its publish date (`npm view <pkg> time --json`). Prefer the newest release that is at least 7 days old; this matches `minimumReleaseAge` in `pnpm-workspace.yaml`.
- For every **major** bump, read the release notes (`gh release view <tag> -R <owner/repo>`) and list the breaking changes that touch this repo.

## 2. Knarr-specific checks

- **Runtime deps are bundled into every entry** (`deps.alwaysBundle` in `tsdown.config.ts`) and live in `devDependencies`; `scripts/verify-pack.mjs` fails if `dependencies` is non-empty or the unpacked size passes its budget, so run it after `pnpm build`. Check each bumped dependency's `engines.node` (`npm view <pkg>@<ver> engines`). If it is above Knarr's floor, either raise `package.json#engines.node` as a **breaking change** (update the README badge, docs/getting-started.md, CONTRIBUTING.md, AGENTS.md, the bug-report template, and the Node check in `src/commands/doctor.ts`) or hold the bump.
- **TypeScript**: the build, `.d.ts`, and lint don't use TypeScript's JS compiler API, so majors are fine. Don't add tooling that needs it (tsup `.d.ts`, typescript-eslint).
- **chokidar**: the options are used in `src/core/watcher.ts` and `src/webpack-plugin.ts`. `src/vite-plugin.ts` uses Vite's own watcher options, so leave it alone. `src/__tests__/watcher.test.ts` is the real-filesystem check.
- **vitest**: the bench files use the test-context `bench` API. Run `pnpm bench --run` after a bump.
- **pnpm**: settings go in `pnpm-workspace.yaml`. Keep it without a `packages:` list. Declare packages with build scripts in `allowBuilds`.
- **Overrides**: add `overrides` to `pnpm-workspace.yaml` only for an advisory that a normal resolution can't fix. Delete overrides once they are no longer needed.
- **Example fixtures** (`examples/packages/*`) have their own npm lockfiles. Run `npm audit` there separately.

## 3. Apply

1. Edit `package.json` ranges (and `packageManager` for pnpm).
2. Regenerate the lockfile so stale transitive versions are dropped: delete `node_modules` and `pnpm-lock.yaml`, then run `pnpm install`.
3. `pnpm audit` should report no vulnerabilities, or document why a remaining one is unreachable.

## 4. Verify

Run the `verify` skill with `full`, plus `pnpm bench --run`. Then update `CHANGELOG.md` "Unreleased" (user-visible effects only) and the `.github/dependabot.yml` ignores for anything deliberately held.

## Report

A table of package, from, to, and notes. Then list held-back majors with the reason for each, any engines change, verification results, and follow-ups.
