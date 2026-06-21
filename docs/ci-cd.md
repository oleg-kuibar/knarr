# CI/CD: Prefer Canary Builds

For CI and release validation, prefer canary or prerelease packages over Knarr.

A canary build publishes a real package artifact to a registry under a
non-`latest` dist-tag such as `canary`, `beta`, or `next`. The consumer then
installs that tag or exact prerelease version through its package manager. That
tests the same path users rely on: registry auth, tarball contents, lockfile
resolution, peer dependencies, install scripts, and integrity checks.

Use these primary sources when setting up canary releases:

- [npm dist-tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/) -
  documents tags such as `canary`, `beta`, and `next`, plus installing with
  `npm install <name>@<tag>`.
- [npm publish --tag](https://docs.npmjs.com/cli/v11/commands/npm-publish/#tag)
  - publishes a version under a tag other than `latest`.
- [Changesets snapshot releases](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md)
  - publishes temporary test versions such as `0.0.0-canary-<timestamp>`.
- [Changesets prereleases](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)
  - manages longer-lived prerelease streams such as `next` or `beta`.

## Recommended Flow

Use this shape for package-to-consumer CI:

1. Build and test the package.
2. Publish a canary or prerelease version with a non-`latest` dist-tag.
3. In the consumer job, install the canary tag or exact canary version.
4. Run the consumer's tests, typecheck, and build.
5. Promote to a normal release only after the canary passes.

With Changesets snapshots, the package side usually looks like this:

```bash
pnpm build
pnpm exec changeset version --snapshot canary
pnpm exec changeset publish --tag canary --no-git-tag
```

The consumer side should use its normal package manager:

```bash
pnpm add my-lib@canary
pnpm test
```

Prefer installing the exact canary version when you need reproducible reruns.
Use the moving `canary` tag when the job should always test the newest canary.

## Where Knarr Fits

Knarr is mainly a local development tool. It is not the recommended CI
integration path for release confidence because it copies files into
`node_modules/` after the package manager has already resolved and installed the
dependency graph. That bypasses important release surfaces that canary builds
exercise.

Use Knarr in CI only for narrow pre-registry smoke tests, for example:

- Testing a package against same-checkout fixture apps before a canary publish.
- Running `knarr check` to catch missing entry points, exports, types, or bin
  paths.
- Exercising a consumer when registry publishing is unavailable in forks or
  local-only automation.

Treat a passing Knarr smoke test as a weaker signal than a passing canary
consumer test.

## Minimal Knarr Smoke Test

If you still need a local smoke test, isolate the store per job and keep the
job small:

```bash
export KNARR_HOME="$(mktemp -d)"

pnpm --filter my-lib build
npx knarr check packages/my-lib --json
npx knarr publish packages/my-lib --json

cd apps/my-app
npx knarr add my-lib --yes
pnpm test
```

`KNARR_HOME` must be job-local so one CI run cannot see another run's mutable
store.

## What CI Should Not Do

- Do not use Knarr as a replacement for canary package tests.
- Do not rely on `knarr dev` in CI; it is a watch command and does not exit.
- Do not cache `KNARR_HOME` between jobs unless you intentionally want shared
  mutable local package state.
- Do not publish a stable `latest` package from a Knarr verification job.
- Do not use Knarr for Yarn PnP consumers. Knarr requires `node_modules`.

## Useful Knarr Commands

`knarr check` validates package metadata without writing to the store:

```bash
npx knarr check packages/my-lib --json
```

`--dry-run` previews mutations without touching the store or consumer project:

```bash
npx knarr publish packages/my-lib --dry-run --json
```

`--json` suppresses human-oriented output and writes structured JSON to stdout.
`--verbose` still writes debug logs to stderr, so this keeps machine output
parseable:

```bash
npx knarr push --json --verbose > push.json 2> knarr-debug.log
```
