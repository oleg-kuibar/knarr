---
name: release
description: Prepare and ship a Knarr npm release (version bump, changelog, preflight, release PR, then the GitHub Publish workflow). Use only when the maintainer asks to cut a release.
argument-hint: "<version>"
disable-model-invocation: true
---

Release `$ARGUMENTS`. Follow `.github/RELEASING.md`; this skill is the condensed checklist. Publishing is outward-facing and can't be undone, so confirm with the user before each step marked ⚠.

1. **Preconditions**: start from an up-to-date `origin/master` with a clean tree. `npm view knarr version` must be lower than `$ARGUMENTS`. If no version was given, propose one from the `## Unreleased` changelog: a breaking change in 0.x bumps the minor version.
2. **Version and changelog**: on branch `release/$ARGUMENTS`, set `package.json#version` and rename `## Unreleased` in `CHANGELOG.md` to `## $ARGUMENTS`. Start the section with a one-line summary, because the workflow publishes the section as the GitHub release notes.
3. **Preflight**: run the `verify` skill with `full`, then `pnpm audit --audit-level=low` and `node scripts/verify-pack.mjs`.
4. **Tarball smoke test**: `npm pack`, then `npx ./knarr-$ARGUMENTS.tgz --help` and `npx ./knarr-$ARGUMENTS.tgz doctor`. Delete the tarball.
5. ⚠ **Release PR**: commit `chore: release $ARGUMENTS`, push, and open the PR. `master` only takes PRs. Merge after CI passes and the user agrees.
6. **Dry run**: `gh workflow run publish.yml --ref master -f dry_run=true`, then `gh run watch`. It needs no approval, and it fails fast on an already-published version or a missing changelog section.
7. ⚠ **Publish**: only on an explicit go-ahead, run `gh workflow run publish.yml --ref master -f dry_run=false`. Tell the user to approve the `npm` environment under the run's **Review deployments**. The workflow then tags `v$ARGUMENTS` and creates the GitHub release. Check with `npm view knarr version dist-tags` and `gh release view v$ARGUMENTS`.

Never publish locally: there is no manual fallback. A local publish would skip provenance and the isolated publish job. If the workflow fails, fix the workflow.
