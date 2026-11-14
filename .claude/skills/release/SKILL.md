---
name: release
description: Prepare a Knarr npm release (version bump, changelog, preflight, tarball smoke test, then the GitHub Publish workflow as a dry run). Use only when the maintainer asks to cut a release.
argument-hint: "<version>"
disable-model-invocation: true
---

Prepare release `$ARGUMENTS`. Follow `.github/RELEASING.md`; this skill is the condensed checklist. Publishing is outward-facing and can't be undone, so confirm with the user before each step marked ⚠.

1. **Preconditions**: on `master`, clean tree, up to date with `origin/master`. `npm view knarr version` must not already be `$ARGUMENTS`.
2. **Version and changelog**: set `package.json#version`. Rename `## Unreleased` in `CHANGELOG.md` to `## $ARGUMENTS`. A breaking change in a 0.x release bumps the minor version.
3. **Preflight**: run the `verify` skill with `full`, then `pnpm audit --audit-level=low` and `node scripts/verify-pack.mjs` (the tarball file allowlist).
4. **Tarball smoke test**: run `npm pack`, then `npx ./knarr-$ARGUMENTS.tgz --help` and `npx ./knarr-$ARGUMENTS.tgz doctor`. Delete the tarball afterwards.
5. ⚠ **Commit**: `chore: release $ARGUMENTS`. Push only after the user confirms.
6. ⚠ **Publish dry run**: `gh workflow run publish.yml -f dry_run=true`, then watch it with `gh run watch`.
7. ⚠ **Publish**: only on an explicit go-ahead, run `gh workflow run publish.yml -f dry_run=false`. Afterwards, check with `npm view knarr version dist-tags`.

Never publish locally: there is no manual fallback. A local publish would skip provenance and the isolated publish job. If the workflow fails, fix the workflow.
